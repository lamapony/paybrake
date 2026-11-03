/* PayBrake service worker. Classic script: importScripts, not type:module.
   Load order matches extension/lib/index.js. Do not import that ESM file. */
importScripts(
  "lib/config.js",
  "lib/brand.js",
  "lib/tidy.js",
  "lib/atoms.js",
  "lib/extract.js",
  "lib/redact.js",
  "lib/pay-risk.js",
  "lib/ask-llm.js",
  "lib/chat-state.js"
);

const LOG_MAX = 200;
const TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKEND = globalThis.pbConfig.DEFAULT_BACKEND;
const FRIENDLY = "Could not reach the PayBrake server. Check your internet connection and try again.";

const memory = new Map();
let logQueue = Promise.resolve();
let healthCache = null;

function rulesVersion() {
  return (globalThis.pbAtoms && globalThis.pbAtoms.RULES_VERSION) || 1;
}

// One cache row per chat text (hash), rules version and check mode ("rules" or "ai").
function cacheKey(hash, mode) {
  return `pb:${hash}:r${rulesVersion()}:${mode}`;
}

const AI_TIMEOUT_MS = 6000;
const inflight = new Map();

// The AI check on all chats defaults ON in this hackathon demo build.
function aiAllFrom(opts) {
  if (typeof opts.aiAll === "boolean") return opts.aiAll;
  return true;
}

function fresh(row) {
  return !!(row && row.ts && Date.now() - row.ts < TTL_MS);
}

async function getOpts() {
  const stored = await chrome.storage.local.get("pb_opts");
  const opts = stored.pb_opts || {};
  return {
    backendUrl: String(opts.backendUrl || DEFAULT_BACKEND).replace(/\/$/, ""),
    aiAll: aiAllFrom(opts),
    debug: Boolean(opts.debug)
  };
}

function cacheable(verdict) {
  return !!(verdict && verdict.llm !== "error" && verdict.llm !== "unavailable");
}

async function readCache(hash, mode) {
  const key = cacheKey(hash, mode);
  const mem = memory.get(key);
  if (mem && fresh(mem) && cacheable(mem.verdict)) return mem;
  const stored = await chrome.storage.local.get(key);
  const row = stored[key];
  if (row && fresh(row) && cacheable(row.verdict)) {
    memory.set(key, row);
    return row;
  }
  return null;
}

async function writeCache(hash, verdict, mode) {
  // Only the verdict is stored, never the chat text.
  const row = { verdict, ts: Date.now() };
  const key = cacheKey(hash, mode);
  if (!cacheable(verdict)) return;
  memory.set(key, row);
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

async function runDetect(text, context, opts, phase, info) {
  const payRisk = globalThis.pbPayRisk;
  if (phase !== "ai" || !opts.aiAll) return payRisk.detect(text, context, {});
  if (!info) {
    const rules = await payRisk.detect(text, context, {});
    return Object.assign({}, rules, { llm: "unavailable" });
  }
  if (info.llm !== "configured") {
    // No AI provider on this server (the hosted test server runs in mock mode):
    // nothing is sent, the rules verdict stands, and the card says so.
    const rules = await payRisk.detect(text, context, {});
    return Object.assign({}, rules, { llm: "off_server" });
  }
  // detect() redacts emails, phones, card numbers, IBANs and codes before askLlm sees the text.
  const ask = (payload) => globalThis.pbAskLlm.askLlm(payload, { baseUrl: opts.backendUrl, timeoutMs: AI_TIMEOUT_MS });
  return payRisk.detect(text, context, { askLlm: ask, llmMode: "all", timeoutMs: AI_TIMEOUT_MS + 250 });
}

async function onDetect(message, opts) {
  const hash = String(message.hash || "");
  const text = String(message.text || "");
  const context = message.context && typeof message.context === "object" ? message.context : {};
  const phase = message.phase === "ai" && opts.aiAll ? "ai" : "rules";
  const info = await health();
  const base = { ok: true, debug: opts.debug, mode: info && info.paypal, aiOn: opts.aiAll, aiServer: info ? info.llm : "unreachable" };
  const cached = hash ? await readCache(hash, phase) : null;
  let verdict;
  let fromCache = false;
  if (cached) {
    verdict = cached.verdict;
    fromCache = true;
  } else {
    const key = hash + ":" + phase;
    let job = hash ? inflight.get(key) : null;
    if (!job) {
      job = runDetect(text, context, opts, phase, info);
      if (hash) inflight.set(key, job);
    }
    try {
      verdict = await job;
    } finally {
      inflight.delete(key);
    }
    if (hash) {
      await writeCache(hash, verdict, phase);
      await rememberDeal(hash, { verdict, context, text: text.slice(0, 500) });
    }
  }
  const response = Object.assign({ verdict }, base, fromCache ? { cached: true } : {});
  const deal = hash ? await loadDeal(hash) : null;
  return globalThis.pbChatState.withStored(response, deal);
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
  const referenceId = hash
    ? [hash, item, amount == null ? "" : String(amount), currency, payeeEmail].join("\u001f")
    : undefined;
  const data = await backendFetch("/api/protect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item,
      amount,
      currency,
      payeeEmail,
      referenceId,
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
  if (message.hash && data && data.status) {
    await rememberDeal(String(message.hash), { status: data.status, orderId: data.orderId });
  }
  return { ok: true, status: data.status, orderId: data.orderId };
}

async function onCapture(message) {
  const id = encodeURIComponent(String(message.orderId || ""));
  const data = await backendFetch("/api/orders/" + id + "/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (message.hash && data && data.status) {
    await rememberDeal(String(message.hash), { status: data.status, orderId: data.orderId });
  }
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

globalThis.pbBackground = { handle };

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || typeof message.type !== "string" || message.type.indexOf("pb:") !== 0) return;
  handle(message).then(respond).catch((error) => {
    respond({ ok: false, error: friendly(error) });
  });
  return true;
});

// First run: open a short welcome tab. The toolbar icon opens it again.
function openWelcome() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === "install") openWelcome();
});

chrome.action.onClicked.addListener(() => {
  openWelcome();
});
