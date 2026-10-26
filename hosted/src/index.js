// PayBrake hosted demo: static demo store + mock backend on one Cloudflare Worker.
// Mock mode only. No PayPal credentials, no AI provider, no real money.
// Orders live in one Durable Object so approve and capture see the same state.
import { DurableObject } from "cloudflare:workers";
import { protectDeal } from "../../backend/src/agent.js";

const BODY_LIMIT = 16 * 1024;
const NOINDEX = "noindex, nofollow, noarchive";
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ORDERS = 5000; // per day; keeps a public mock server from filling storage

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

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const orders = ordersPort(env, url.origin);

  if (request.method === "GET" && path === "/health") {
    return json(200, { ok: true, name: "PayBrake", env: "sandbox", paypal: "mock", llm: "off", llmProvider: "off", hosted: true });
  }
  if (request.method === "POST" && path === "/api/classify") {
    await readJson(request);
    return json(503, { error: "llm_off" });
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
