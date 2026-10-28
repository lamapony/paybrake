// PayBrake hosted demo: static demo store + mock backend on one Cloudflare Worker.
// Mock PayPal only: no PayPal credentials, no real money. The AI check uses Typesafe when the
// TYPESAFE_API_KEY secret is set (same classify code as the backend), otherwise it is off.
// Orders live in one Durable Object so approve and capture see the same state.
import { DurableObject } from "cloudflare:workers";
import { protectDeal } from "../../backend/src/agent.js";
import { classifyText } from "../../backend/src/classify.js";
import "../../extension/lib/redact.js";

const BODY_LIMIT = 16 * 1024;
const NOINDEX = "noindex, nofollow, noarchive";
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ORDERS = 5000; // per day; keeps a public mock server from filling storage
const MAX_AI_PER_DAY = 20000; // all users together; ~$1/day at Typesafe list price
const AI_TEXT_LIMIT = 4000;
const AI_PER_IP_PER_MINUTE = 30;

// The AI config is fixed here, not taken from vars: pinned model, dev-tuned add bar, 6 s timeout.
export function aiEnv(env) {
  const key = env && typeof env.TYPESAFE_API_KEY === "string" ? env.TYPESAFE_API_KEY.trim() : "";
  if (!key) return null;
  return { LLM_PROVIDER: "typesafe", TYPESAFE_API_KEY: key, TYPESAFE_MODEL: "jev-1.14.0", TYPESAFE_ADD_CONFIDENCE: "0.5", LLM_TIMEOUT_MS: "6000" };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "x-robots-tag": NOINDEX,
      "cache-control": "no-store"
    }, extra)
  });
}

function cors(request) {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const self = new URL(request.url).origin;
  const ok = origin === self || origin.startsWith("chrome-extension://") ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return {};
  return {
    "access-control-allow-origin": origin,
    "vary": "origin",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600"
  };
}

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > BODY_LIMIT) throw Object.assign(new Error("payload too large"), { status: 413 });
  // Count bytes as they stream so chunked bodies cannot grow past the limit.
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw Object.assign(new Error("payload too large"), { status: 413 });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  if (!raw.trim()) return {};
  let body;
  try { body = JSON.parse(raw); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("JSON body must be an object"), { status: 400 });
  }
  return body;
}

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw Object.assign(new Error("amount must be a number"), { status: 400 });
  return (Math.round(n * 100) / 100).toFixed(2);
}

export class MockOrders extends DurableObject {
  async fetch(request) {
    const { op, id, deal, origin } = await request.json();
    const store = this.ctx.storage;
    if (op === "ai_quota") {
      // Strict per-IP limit: one Durable Object sees every call. Kept in memory, per minute.
      const minute = Math.floor(Date.now() / 60000);
      if (!this.hits || this.hitsMinute !== minute) { this.hits = new Map(); this.hitsMinute = minute; }
      const ipKey = String(id || "unknown").slice(0, 64);
      const n = (this.hits.get(ipKey) || 0) + 1;
      this.hits.set(ipKey, n);
      if (n > AI_PER_IP_PER_MINUTE) return Response.json({ ok: false, reason: "rate" }, { status: 429 });
      const day = "ai:" + new Date().toISOString().slice(0, 10);
      const used = (await store.get(day)) || 0;
      if (used >= MAX_AI_PER_DAY) return Response.json({ ok: false }, { status: 429 });
      await store.put(day, used + 1);
      return Response.json({ ok: true });
    }
    if (op === "create") {
      const count = (await store.get("meta:count")) || 0;
      if (count >= MAX_ORDERS) return Response.json({ error: "busy" }, { status: 429 });
      await store.put("meta:count", count + 1);
      const orderId = `MOCK-${crypto.randomUUID()}`;
      const record = {
        orderId,
        status: "CREATED",
        item: String(deal.item || "").slice(0, 200),
        amount: formatAmount(deal.amount),
        currency: String(deal.currency || "").toUpperCase(),
        payeeEmail: deal.payeeEmail ? String(deal.payeeEmail).slice(0, 200) : "",
        approveUrl: `${origin}/demo/checkout-return.html?token=${encodeURIComponent(orderId)}&mock=1`,
        captureId: null,
        ts: Date.now()
      };
      await store.put(orderId, record);
      if (!(await store.getAlarm())) await store.setAlarm(Date.now() + ORDER_TTL_MS);
      return Response.json({ orderId, status: record.status, approveUrl: record.approveUrl });
    }
    const key = String(id || "");
    const record = key.startsWith("MOCK-") ? await store.get(key) : null;
    if (!record) return Response.json(null);
    if (op === "approve" && record.status === "CREATED") record.status = "APPROVED";
    if (op === "capture") {
      if (record.status === "CREATED") return Response.json({ error: "not_approved" }, { status: 409 });
      if (record.status !== "COMPLETED") {
        record.status = "COMPLETED";
        record.captureId = `MOCK-CAP-${crypto.randomUUID()}`;
      }
    }
    if (op !== "get") await store.put(record.orderId, record);
    return Response.json({ orderId: record.orderId, status: record.status, captureId: record.captureId, approveUrl: record.approveUrl });
  }

  async alarm() {
    // Drop mock orders older than a day; keep the demo store small.
    const cutoff = Date.now() - ORDER_TTL_MS;
    const all = await this.ctx.storage.list({ prefix: "MOCK-" });
    const old = [...all].filter(([, v]) => !v || v.ts < cutoff).map(([k]) => k);
    for (let i = 0; i < old.length; i += 128) await this.ctx.storage.delete(old.slice(i, i + 128));
    const left = all.size - old.length;
    await this.ctx.storage.put("meta:count", left);
    if (left > 0) await this.ctx.storage.setAlarm(Date.now() + ORDER_TTL_MS);
  }
}

function ordersPort(env, origin) {
  const stub = env.ORDERS.get(env.ORDERS.idFromName("demo"));
  async function call(payload) {
    const res = await stub.fetch("https://orders/", { method: "POST", body: JSON.stringify(Object.assign({ origin }, payload)) });
    const data = await res.json();
    if (res.status === 429) throw Object.assign(new Error("The demo server is busy. Try again tomorrow."), { status: 429 });
    if (res.status === 409) throw Object.assign(new Error("Order is not approved"), { status: 409, code: "not_approved" });
    return data;
  }
  return {
    mode: "mock",
    createOrder: (deal) => call({ op: "create", deal }),
    getOrder: (id) => call({ op: "get", id }),
    approve: (id) => call({ op: "approve", id }),
    captureOrder: (id) => call({ op: "capture", id })
  };
}

async function classify(request, env) {
  const body = await readJson(request);
  const ai = aiEnv(env);
  if (!ai) return json(503, { error: "llm_off" });
  if (typeof body.text !== "string" || !body.text.trim()) return json(400, { error: "bad_request", message: "text is required" });
  if (body.text.length > AI_TEXT_LIMIT) return json(400, { error: "bad_request", message: "text is too long" });
  // Abuse protection: per-IP limit (approximate, per location), then a strict daily cap.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.AI_LIMIT) {
    const { success } = await env.AI_LIMIT.limit({ key: "classify:" + ip });
    if (!success) return json(429, { error: "rate_limited" }, { "retry-after": "60" });
  }
  if (env.ORDERS) {
    const stub = env.ORDERS.get(env.ORDERS.idFromName("demo"));
    const quota = await stub.fetch("https://orders/", { method: "POST", body: JSON.stringify({ op: "ai_quota", id: ip }) });
    if (quota.status === 429) {
      const why = await quota.json().catch(() => ({}));
      if (why && why.reason === "rate") return json(429, { error: "rate_limited" }, { "retry-after": "60" });
      return json(429, { error: "busy", message: "The demo AI check is busy. Try again tomorrow." });
    }
  }
  // The extension masks before sending; mask again here for direct callers (the mask is idempotent).
  const text = globalThis.pbRedact.redact(body.text);
  // The caller may send its rules level; the AI may lower it but never raise it.
  const rulesLevel = body.rulesLevel === "high" || body.rulesLevel === "medium" ? body.rulesLevel : "";
  const aiEnvWithLevel = rulesLevel ? { ...ai, PAYBRAKE_RULES_LEVEL: rulesLevel } : ai;
  try {
    const verdict = await classifyText(text, aiEnvWithLevel);
    return json(200, { ...verdict, provider: "typesafe" });
  } catch (error) {
    if (error && error.status === 400) return json(400, { error: "bad_request", message: "text is too long" });
    // Rules-only fallback happens in the extension on any non-200.
    return json(502, { error: "llm_error" });
  }
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const orders = ordersPort(env, url.origin);

  if (request.method === "GET" && path === "/health") {
    const ai = aiEnv(env);
    return json(200, { ok: true, name: "PayBrake", env: "sandbox", paypal: "mock", llm: ai ? "configured" : "off", llmProvider: ai ? "typesafe" : "off", hosted: true });
  }
  if (request.method === "POST" && path === "/api/classify") {
    return classify(request, env);
  }
  if (request.method === "POST" && path === "/api/protect") {
    const body = await readJson(request);
    return json(200, await protectDeal(body, orders));
  }
  const m = path.match(/^\/api\/orders\/([^/]+)(?:\/(capture|approve-mock))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const action = m[2] || "";
    if (request.method === "GET" && !action) {
      const order = await orders.getOrder(id);
      return order ? json(200, { orderId: order.orderId, status: order.status }) : json(404, { error: "not_found" });
    }
    if (request.method === "POST" && action === "approve-mock") {
      await readJson(request);
      const order = await orders.approve(id);
      return order ? json(200, { orderId: order.orderId, status: order.status }) : json(404, { error: "not_found" });
    }
    if (request.method === "POST" && action === "capture") {
      await readJson(request);
      const order = await orders.captureOrder(id);
      return order ? json(200, { orderId: order.orderId, status: order.status, captureId: order.captureId }) : json(404, { error: "not_found" });
    }
  }
  if (request.method === "GET" && (path === "/return" || path === "/cancel")) {
    const token = url.searchParams.get("token") || "";
    if (path === "/return" && token) await orders.approve(token);
    const dest = new URL("/demo/checkout-return.html", url.origin);
    if (token) dest.searchParams.set("token", token);
    dest.searchParams.set("mock", "1");
    if (path === "/cancel") dest.searchParams.set("cancel", "1");
    return new Response(null, { status: 302, headers: { location: dest.toString(), "x-robots-tag": NOINDEX } });
  }
  return json(404, { error: "not_found" });
}

export default {
  async fetch(request, env) {
    const extra = cors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: extra });
    let res;
    try {
      res = await api(request, env);
    } catch (error) {
      const status = error && error.status;
      if (status === 413) res = json(413, { error: "payload_too_large" });
      else if (status === 400) res = json(400, { error: "bad_request", message: String(error.message || "bad_request") });
      else if (status === 409) res = json(409, { error: error.code || "conflict" });
      else if (status === 429) res = json(429, { error: "busy", message: error.message });
      else res = json(500, { error: "internal" });
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
    return out;
  }
};
