// PayBrake hosted demo: static demo store + order backend on one Cloudflare Worker.
// PayPal sandbox (Orders v2) when the PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET secrets are set, otherwise a
// mock with no credentials. Never live: the rest adapter refuses any non-sandbox host. No real money. The AI check uses Typesafe when the
// TYPESAFE_API_KEY secret is set (same classify code as the backend), otherwise it is off.
// Orders live in one Durable Object so approve and capture see the same state.
import { DurableObject } from "cloudflare:workers";
import { protectDeal } from "../../backend/src/agent.js";
import { classifyText } from "../../backend/src/classify.js";
import { createRestPort } from "../../backend/src/paypal-rest.js";
import "../../extension/lib/redact.js";

const BODY_LIMIT = 16 * 1024;
const NOINDEX = "noindex, nofollow, noarchive";
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ORDERS = 5000; // per day; keeps a public mock server from filling storage
// Abuse protection for the AI check (the Typesafe key is Dima's own; it must not get burned).
// Defaults below; vars can lower them (never raise past the hard maxima). Listed in README ("Hosted demo limits").
const AI_TEXT_LIMIT = 2000; // characters per /api/classify call (the extension keeps the latest 1900)
const AI_PER_IP_PER_MINUTE = 20; // strict, counted in the Durable Object
const AI_PER_IP_PER_DAY = 150;
const AI_PER_DAY = 2000; // all users together
const HARD_MAX = { AI_PER_IP_PER_MINUTE: 60, AI_PER_IP_PER_DAY: 1000, AI_PER_DAY: 20000 };

function limitFrom(env, name, fallback) {
  const raw = env && env[name] != null ? Number(env[name]) : NaN;
  const n = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
  return Math.min(n, HARD_MAX[name]);
}

export function aiLimits(env) {
  return {
    perIpPerMinute: limitFrom(env, "AI_PER_IP_PER_MINUTE", AI_PER_IP_PER_MINUTE),
    perIpPerDay: limitFrom(env, "AI_PER_IP_PER_DAY", AI_PER_IP_PER_DAY),
    perDay: limitFrom(env, "AI_PER_DAY", AI_PER_DAY),
    textLimit: AI_TEXT_LIMIT
  };
}

// Kill switch: set AI_KILL_SWITCH to 1/true/on (wrangler secret put AI_KILL_SWITCH, no redeploy needed)
// and the AI check is off at once. The extension then falls back to its on-device rules.
export function aiKilled(env) {
  const v = env && env.AI_KILL_SWITCH != null ? String(env.AI_KILL_SWITCH).trim().toLowerCase() : "";
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

// The AI config is fixed here, not taken from vars: pinned model, dev-tuned add bar, 6 s timeout.
export function aiEnv(env) {
  if (aiKilled(env)) return null;
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

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Page not found · PayBrake</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<style>
  body { margin: 0; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; background: #eef1f5; color: #1c2530; }
  main { max-width: 680px; margin: 40px auto; padding: 0 20px 40px; }
  .panel { background: #fff; border: 1px solid #dde3ea; border-radius: 14px; padding: 26px 28px; }
  h1 { margin: 0; font-size: 28px; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
  .links { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 0; }
  .btn { display: inline-block; background: #1f5fbf; color: #fff; text-decoration: none; font-weight: 700; padding: 13px 20px; border-radius: 10px; }
  .btn.alt { background: #fff; color: #1f5fbf; border: 2px solid #1f5fbf; padding: 11px 18px; }
</style>
</head>
<body>
<main>
  <section class="panel">
    <div class="brand"><img src="/logo.svg" width="56" height="56" alt="PayBrake logo"><h1>This page doesn't exist</h1></div>
    <p>The address may be incomplete. The PayBrake demo is still running.</p>
    <p class="links"><a class="btn" href="/">Go to the demo home</a><a class="btn alt" href="/demo/marketplace.html?live=1">Open the demo store</a></p>
  </section>
</main>
</body>
</html>
`;

function notFoundPage() {
  return new Response(NOT_FOUND_PAGE, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": NOINDEX,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store"
    }
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
      // Strict per-IP limits plus a global daily cap: one Durable Object sees every call.
      const lim = deal || {};
      const now = Date.now();
      const minute = Math.floor(now / 60000);
      const today = new Date(now).toISOString().slice(0, 10);
      if (!this.hits || this.hitsMinute !== minute) { this.hits = new Map(); this.hitsMinute = minute; }
      const ipKey = String(id || "unknown").slice(0, 64);
      const n = (this.hits.get(ipKey) || 0) + 1;
      this.hits.set(ipKey, n);
      if (n > lim.perIpPerMinute) return Response.json({ ok: false, reason: "rate" }, { status: 429 });
      const ipDay = "aiip:" + today + ":" + ipKey;
      const ipUsed = (await store.get(ipDay)) || 0;
      if (ipUsed >= lim.perIpPerDay) return Response.json({ ok: false, reason: "ip_day" }, { status: 429 });
      const day = "ai:" + today;
      const used = (await store.get(day)) || 0;
      if (used >= lim.perDay) return Response.json({ ok: false, reason: "day" }, { status: 429 });
      await store.put({ [day]: used + 1, [ipDay]: ipUsed + 1 });
      if (!this.aiAlarmSet) {
        this.aiAlarmSet = true;
        if (!(await store.getAlarm())) await store.setAlarm(now + ORDER_TTL_MS);
      }
      return Response.json({ ok: true, left: lim.perDay - used - 1 });
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
    // Drop AI counters from earlier days (per-IP day keys and the global day key).
    const today = new Date().toISOString().slice(0, 10);
    const counters = [];
    for (const prefix of ["aiip:", "ai:"]) {
      const rows = await this.ctx.storage.list({ prefix });
      for (const k of rows.keys()) if (k.slice(prefix.length, prefix.length + 10) !== today) counters.push(k);
    }
    for (let i = 0; i < counters.length; i += 128) await this.ctx.storage.delete(counters.slice(i, i + 128));
    const aiLeft = (await this.ctx.storage.list({ prefix: "aiip:" })).size;
    if (left > 0 || aiLeft > 0) await this.ctx.storage.setAlarm(Date.now() + ORDER_TTL_MS);
  }
}

// Sandbox mode needs both secrets. Anything missing means mock, so the public demo never breaks.
export function sandboxConfigured(env) {
  const id = env && typeof env.PAYPAL_CLIENT_ID === "string" ? env.PAYPAL_CLIENT_ID.trim() : "";
  const secret = env && typeof env.PAYPAL_CLIENT_SECRET === "string" ? env.PAYPAL_CLIENT_SECRET.trim() : "";
  return Boolean(id && secret);
}

let restCache = null; // keeps the OAuth token between requests in one isolate
function sandboxPort(env, origin) {
  const key = origin + "|" + env.PAYPAL_CLIENT_ID;
  if (!restCache || restCache.key !== key) {
    const port = createRestPort({
      PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID.trim(),
      PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET.trim(),
      PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
      PAYPAL_RETURN_URL: origin + "/return",
      PAYPAL_CANCEL_URL: origin + "/cancel"
    });
    restCache = { key, port };
  }
  const rest = restCache.port;
  // Demo sellers use example.com emails that are not sandbox accounts. Pay the sandbox Business
  // account in PAYPAL_PAYEE_EMAIL if set, else the app's own sandbox merchant (no payee field).
  const payee = typeof env.PAYPAL_PAYEE_EMAIL === "string" ? env.PAYPAL_PAYEE_EMAIL.trim() : "";
  return {
    mode: "rest",
    createOrder: (deal) => rest.createOrder({ ...deal, payeeEmail: payee || undefined }),
    getOrder: (id) => rest.getOrder(id),
    approve: async () => null, // approval happens on PayPal's sandbox page
    captureOrder: (id) => rest.captureOrder(id)
  };
}

function ordersPort(env, origin) {
  if (sandboxConfigured(env)) return sandboxPort(env, origin);
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

// Rate-limit key: the IPv4 address, or the /64 prefix of an IPv6 address (one IPv6 host usually owns a whole /64).
export function ipBucket(ip) {
  const raw = String(ip || "unknown").trim().toLowerCase();
  if (!raw.includes(":")) return raw.slice(0, 64);
  const [head, tail = ""] = raw.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = raw.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

async function classify(request, env) {
  const body = await readJson(request);
  const ai = aiEnv(env);
  if (!ai) return json(503, { error: "llm_off" });
  if (typeof body.text !== "string" || !body.text.trim()) return json(400, { error: "bad_request", message: "text is required" });
  if (body.text.length > AI_TEXT_LIMIT) return json(413, { error: "text_too_long", max: AI_TEXT_LIMIT });
  // Abuse protection: per-IP limit (approximate, per location), then strict per-IP and daily caps.
  const ip = ipBucket(request.headers.get("cf-connecting-ip") || "unknown");
  if (env.AI_LIMIT) {
    const { success } = await env.AI_LIMIT.limit({ key: "classify:" + ip });
    if (!success) return json(429, { error: "rate_limited" }, { "retry-after": "60" });
  }
  if (!env.ORDERS) return json(503, { error: "llm_off" }); // no counter, no AI: never call the model unmetered
  const stub = env.ORDERS.get(env.ORDERS.idFromName("demo"));
  const quota = await stub.fetch("https://orders/", { method: "POST", body: JSON.stringify({ op: "ai_quota", id: ip, deal: aiLimits(env) }) });
  if (quota.status === 429) {
    const why = await quota.json().catch(() => ({}));
    if (why && why.reason === "rate") return json(429, { error: "rate_limited" }, { "retry-after": "60" });
    return json(429, { error: "busy", message: "The demo AI check has reached its daily limit. PayBrake still checks with its on-device rules. Try the AI check again tomorrow." });
  }
  // The extension masks before sending; mask again here for direct callers (the mask is idempotent).
  const text = globalThis.pbRedact.redact(body.text);
  // The caller may send its rules level; the AI may lower it but never raise it.
  // "none" is not a cap. Passed as its own argument, not mixed into the Worker env.
  const rulesLevel = body.rulesLevel === "high" || body.rulesLevel === "medium" ? body.rulesLevel : "";
  try {
    const verdict = await classifyText(text, ai, globalThis.fetch, rulesLevel);
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
    const lim = aiLimits(env);
    return json(200, {
      ok: true, name: "PayBrake", env: "sandbox", paypal: orders.mode,
      llm: ai ? "configured" : "off", llmProvider: ai ? "typesafe" : "off", hosted: true,
      aiLimits: { perIpPerMinute: lim.perIpPerMinute, perIpPerDay: lim.perIpPerDay, perDay: lim.perDay, maxChars: lim.textLimit },
      aiKillSwitch: aiKilled(env)
    });
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
    if (path === "/return" && token && orders.mode === "mock") await orders.approve(token);
    const dest = new URL("/demo/checkout-return.html", url.origin);
    if (token) dest.searchParams.set("token", token);
    if (orders.mode === "mock") dest.searchParams.set("mock", "1");
    if (path === "/cancel") dest.searchParams.set("cancel", "1");
    return new Response(null, { status: 302, headers: { location: dest.toString(), "x-robots-tag": NOINDEX } });
  }
  const isApi = path === "/api" || path.startsWith("/api/");
  if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
    if (path === "/demo" || path === "/demo/") {
      return new Response(null, { status: 302, headers: { location: new URL("/", url.origin).toString(), "x-robots-tag": NOINDEX } });
    }
    return notFoundPage();
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
