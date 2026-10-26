/* PayBrake service worker. Classic script: importScripts, not type:module.
   Load order matches extension/lib/index.js. Do not import that ESM file. */
importScripts(
  "lib/brand.js",
  "lib/tidy.js",
  "lib/atoms.js",
  "lib/extract.js",
  "lib/pay-risk.js",
  "lib/ask-llm.js"
);

const LOG_MAX = 200;
const TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKEND = "http://localhost:8787";
const FRIENDLY = "Could not reach PayBrake. Start the backend and try again.";

const memory = new Map();
let logQueue = Promise.resolve();
let healthCache = null;

function rulesVersion() {
  return (globalThis.pbAtoms && globalThis.pbAtoms.RULES_VERSION) || 1;
}

function cacheKey(hash) {
  return `pb:${hash}:r${rulesVersion()}`;
}

function fresh(row) {
  return !!(row && row.ts && Date.now() - row.ts < TTL_MS);
}

async function getOpts() {
  const stored = await chrome.storage.local.get("pb_opts");
  const opts = stored.pb_opts || {};
  return {
    backendUrl: String(opts.backendUrl || DEFAULT_BACKEND).replace(/\/$/, ""),
    llm: Boolean(opts.llm),
    debug: Boolean(opts.debug)
  };
}

async function readCache(hash, llmOn) {
  const key = cacheKey(hash);
  const mem = memory.get(key);
  if (mem && fresh(mem) && mem.llmOn === llmOn && mem.verdict && mem.verdict.llm !== "error") return mem;
  const stored = await chrome.storage.local.get(key);
  const row = stored[key];
  if (row && fresh(row) && row.llmOn === llmOn && row.verdict && row.verdict.llm !== "error") {
    memory.set(key, row);
    return row;
  }
  return null;
}

async function writeCache(hash, verdict, llmOn, context) {
  const row = { verdict, llmOn, context, ts: Date.now() };
  const key = cacheKey(hash);
  memory.set(key, row);
  if (verdict && verdict.llm === "error") return;
  await chrome.storage.local.set({ [key]: row });
}

async function rememberDeal(hash, patch) {
  if (!hash) return patch;
  const key = `pbdeal:${hash}`;
  const cur = (await chrome.storage.local.get(key))[key] || {};
  const next = Object.assign({}, cur, patch, { ts: Date.now() });
  await chrome.storage.local.set({ [key]: next });
  return next;
}

async function loadDeal(hash) {
  if (!hash) return {};
  const key = `pbdeal:${hash}`;
  return (await chrome.storage.local.get(key))[key] || {};
}

async function appendLog(entry) {
  const row = {
    hash: String(entry.hash || ""),
    signals: Array.isArray(entry.signals) ? entry.signals : [],
    level: String(entry.level || ""),
    action: String(entry.action || "mark"),
    ts: entry.ts || Date.now(),
    head: String(entry.head || "").slice(0, 160)
  };
  logQueue = logQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get("pb_log");
    const prev = Array.isArray(stored.pb_log) ? stored.pb_log : [];
    await chrome.storage.local.set({ pb_log: prev.concat(row).slice(-LOG_MAX) });
  });
  await logQueue;
}

function friendly(error) {
  if (!error) return FRIENDLY;
  if (error.code === "not_approved" || error.status === 409) {
    return "Approve the sandbox order first, then capture.";
  }
  if (error.status === 400 && error.message && error.message !== "bad_request") return error.message;
  if (error.name === "AbortError" || error.name === "TypeError") return FRIENDLY;
  if (!error.status) return FRIENDLY;
  return error.message || FRIENDLY;
}

async function backendFetch(path, opts, timeoutMs) {
  const options = await getOpts();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
  try {
    const res = await fetch(options.backendUrl + path, Object.assign({}, opts, { signal: ctrl.signal }));
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error((data && (data.message || data.error)) || FRIENDLY);
      error.status = res.status;
      error.code = data && data.error;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function health() {
  if (healthCache && Date.now() - healthCache.ts < 5000) return healthCache.data;
  try {
    const data = await backendFetch("/health", { method: "GET" }, 1500);
    healthCache = { ts: Date.now(), data };
    return data;
  } catch {
    healthCache = null;
    return null;
  }
}

async function onDetect(message, opts) {
  const hash = String(message.hash || "");
  const text = String(message.text || "");
  const context = message.context && typeof message.context === "object" ? message.context : {};
  const cached = hash ? await readCache(hash, opts.llm) : null;
  const info = await health();
  if (cached) {
    return { ok: true, verdict: cached.verdict, debug: opts.debug, mode: info && info.paypal, cached: true };
  }
  const ask = opts.llm
    ? (payload) => globalThis.pbAskLlm.askLlm(payload, { baseUrl: opts.backendUrl })
    : null;
  const verdict = await globalThis.pbPayRisk.detect(text, context, ask ? { askLlm: ask } : {});
  if (hash) {
    await writeCache(hash, verdict, opts.llm, context);
    await rememberDeal(hash, { verdict, context, text: text.slice(0, 500) });
  }
  return { ok: true, verdict, debug: opts.debug, mode: info && info.paypal };
}

async function onProtect(message) {
  const hash = String(message.hash || "");
  const stored = await loadDeal(hash);
  const verdict = message.verdict || stored.verdict || {};
  const deal = verdict.deal || {};
  const context = stored.context || message.context || {};
  const item = message.item || deal.item || context.listingTitle || "";
  const amount = message.amount != null ? message.amount : deal.amount;
  const currency = message.currency || deal.currency || "";
  const payeeEmail = message.payeeEmail || deal.payeeEmail || context.sellerEmail || "";
  const data = await backendFetch("/api/protect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item,
      amount,
      currency,
      payeeEmail,
      verdict: {
        level: verdict.level,
        signals: verdict.signals,
        reason: verdict.reason
      }
    })
  });
  await rememberDeal(hash, {
    orderId: data.orderId,
    approveUrl: data.approveUrl,
    mode: data.mode,
    status: data.status,
    verdict
  });
  await appendLog({
    hash,
    signals: verdict.signals,
    level: verdict.level,
    action: "protect",
    head: verdict.reason || item
  });
  return {
    ok: true,
    orderId: data.orderId,
    approveUrl: data.approveUrl,
    mode: data.mode,
    status: data.status
  };
}

async function onStatus(message) {
  const id = encodeURIComponent(String(message.orderId || ""));
  const data = await backendFetch("/api/orders/" + id, { method: "GET" });
  return { ok: true, status: data.status, orderId: data.orderId };
}

async function onCapture(message) {
  const id = encodeURIComponent(String(message.orderId || ""));
  const data = await backendFetch("/api/orders/" + id + "/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  return { ok: true, status: data.status, orderId: data.orderId, captureId: data.captureId };
}

async function onOverride(message) {
  const hash = String(message.hash || "");
  const stored = await loadDeal(hash);
  const verdict = stored.verdict || {};
  await appendLog({
    hash,
    signals: message.signals || verdict.signals || [],
    level: message.level || verdict.level || "",
    action: "override",
    head: message.head || verdict.reason || ""
  });
  await rememberDeal(hash, { override: true });
  return { ok: true };
}

async function onMark(message) {
  await appendLog({
    hash: message.hash,
    signals: message.signals || [],
    level: message.level || "",
    action: message.action || "mark",
    head: message.head || ""
  });
  return { ok: true, mark: message.action || "mark" };
}

async function handle(message) {
  const opts = await getOpts();
  if (message.type === "pb:detect") return onDetect(message, opts);
  if (message.type === "pb:protect") return onProtect(message);
  if (message.type === "pb:status") return onStatus(message);
  if (message.type === "pb:capture") return onCapture(message);
  if (message.type === "pb:override") return onOverride(message);
  if (message.type === "pb:mark") return onMark(message);
  return { ok: false, error: "Unknown message" };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || typeof message.type !== "string" || message.type.indexOf("pb:") !== 0) return;
  handle(message).then(respond).catch((error) => {
    respond({ ok: false, error: friendly(error) });
  });
  return true;
});
