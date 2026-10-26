// LLM classify wrapper. The evidence guard is local and tested offline.
// Provider calls go through the injected fetch. Not configured → 503 llm_off
// and fetch is not called. Error text never includes the provider body.

const BANNED = /guarantee|you are protected|100%\s*safe/i;
const FALLBACK = "Risky payment request: a direct transfer may be hard to get back if the item never arrives.";
const TEXT_LIMIT = 4000;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_REFERER = "https://github.com/lamapony/paybrake";
export const SIGNALS = ["friends_family", "upfront_deposit", "off_platform", "pay_before_see", "credential_request", "remote_access", "phishing_link", "fee_via_link", "impersonation", "account_threat", "urgency_pressure", "other"];
export const SYSTEM = [
  "You are PayBrake's scam check for one chat or message.",
  "Lines may start with \"Them:\" (the other person: seller, caller or sender) or \"Me:\" (the PayBrake user). Judge only what Them asks for or pushes. A Me line never makes a chat risky.",
  "Risky means Them pushes the user toward losing money or account access: paying outside a protected checkout (bank transfer, IBAN, Friends and Family, gift cards, crypto, Zelle, Venmo, Western Union, MobilePay to a stranger), a deposit or fee before the user gets something (delivery, customs, prize, refund, job, loan), sharing card numbers, CVV, one-time or SMS codes, MitID, NemID or BankID codes or logins, passwords or ID numbers, installing remote-access apps (AnyDesk, TeamViewer), opening a login or payment link from an unknown or lookalike site, or posing as a bank, authority, platform or support team.",
  "Not risky: normal buying and selling, pay on pickup, platform checkout, delivery or bank notices without a link or fee ask, messages that tell the user never to share a code, plain marketing.",
  "Reply with JSON only: {risky:boolean, level:\"high\"|\"medium\"|\"none\", confidence:number from 0 to 1 (how sure you are of your verdict), signal: one of " + SIGNALS.join("|") + ", reason:string of at most 120 characters in plain words for the user, evidence:string[], item:string|null, amount:number|null, currency:string|null}.",
  "Every evidence string must be a short verbatim substring of a Them line. Do not promise a refund or that the user is safe."
].join(" ");

export function normalizeWs(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function evidenceIsSubstring(quote, input) {
  const q = normalizeWs(quote);
  if (!q) return false;
  return normalizeWs(input).includes(q);
}

export function evidencePasses(evidence, input) {
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  return evidence.every((quote) => typeof quote === "string" && evidenceIsSubstring(quote, input));
}

export function sanitizeReason(reason, fallback = FALLBACK) {
  const text = normalizeWs(reason);
  if (!text || text.length > 120 || BANNED.test(text)) return fallback;
  return text;
}

function trim(value) {
  return String(value ?? "").trim();
}

function timeoutMsOf(env) {
  const raw = trim(env.LLM_TIMEOUT_MS);
  if (!raw) return 8000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8000;
  return n;
}

function offResult(timeoutMs) {
  return {
    configured: false,
    provider: "off",
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutMs
  };
}

export function resolveLlm(env = {}) {
  const timeoutMs = timeoutMsOf(env);
  const asked = trim(env.LLM_PROVIDER).toLowerCase();
  if (asked === "off") return offResult(timeoutMs);

  let provider = asked;
  if (!provider) {
    if (trim(env.LLM_BASE_URL)) provider = "openai-compatible";
    else if (trim(env.OPENROUTER_API_KEY)) provider = "openrouter";
    else return offResult(timeoutMs);
  }

  if (provider === "openrouter") {
    const apiKey = trim(env.OPENROUTER_API_KEY) || trim(env.LLM_API_KEY);
    if (!apiKey) return offResult(timeoutMs);
    const baseUrl = (trim(env.LLM_BASE_URL) || OPENROUTER_BASE).replace(/\/+$/, "");
    const model = trim(env.LLM_MODEL) || "openai/gpt-4o-mini";
    return { configured: true, provider: "openrouter", baseUrl, apiKey, model, timeoutMs };
  }

  if (provider === "openai-compatible") {
    const baseUrl = trim(env.LLM_BASE_URL).replace(/\/+$/, "");
    if (!baseUrl) return offResult(timeoutMs);
    return {
      configured: true,
      provider: "openai-compatible",
      baseUrl,
      apiKey: trim(env.LLM_API_KEY),
      model: trim(env.LLM_MODEL) || "gpt-4o-mini",
      timeoutMs
    };
  }

  return offResult(timeoutMs);
}

function llmError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  error.code = status === 503 ? "llm_off" : "llm_error";
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "bad_request";
  return error;
}

function stripFences(content) {
  let text = String(content).trim();
  if (!text.startsWith("```")) return text;
  text = text.replace(/^```(?:json)?\s*/i, "");
  text = text.replace(/\s*```$/, "");
  return text.trim();
}

export async function classifyText(text, env = {}, fetchImpl = globalThis.fetch) {
  const llm = resolveLlm(env);
  if (!llm.configured) throw llmError("llm_off", 503);
  const source = String(text ?? "");
  if (source.length > TEXT_LIMIT) throw badRequest("text is too long");

  const headers = { "content-type": "application/json" };
  if (llm.apiKey) headers.authorization = `Bearer ${llm.apiKey}`;
  if (llm.provider === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_REFERER;
    headers["X-Title"] = "PayBrake";
  }

  let res;
  try {
    res = await fetchImpl(llm.baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llm.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: source }
        ]
      }),
      signal: AbortSignal.timeout(llm.timeoutMs)
    });
  } catch {
    throw llmError("llm error", 502);
  }

  if (!res.ok) {
    try { await res.text(); } catch { /* discard provider body */ }
    throw llmError(`llm ${res.status}`, 502);
  }

  let raw = "";
  try {
    raw = await res.text();
  } catch {
    throw llmError("llm error", 502);
  }

  let parsed;
  try {
    const body = JSON.parse(raw);
    const content = body?.choices?.[0]?.message?.content ?? body;
    parsed = typeof content === "string" ? JSON.parse(stripFences(content)) : content;
    if (!parsed || typeof parsed !== "object") throw new Error("shape");
  } catch {
    throw llmError(`llm ${res.status}`, 502);
  }

  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.filter((quote) => typeof quote === "string") : [];
  const ok = parsed.risky === true && evidencePasses(evidence, source);
  const conf = Number(parsed.confidence);
  // A "risky" answer with bad evidence is dropped; its confidence must not count as a confident "safe".
  const confidence = Number.isFinite(conf) && !(parsed.risky === true && !ok) ? Math.max(0, Math.min(1, conf)) : null;
  const signal = SIGNALS.includes(parsed.signal) ? parsed.signal : (ok ? "other" : null);
  return {
    risky: ok,
    level: ok ? (parsed.level === "high" ? "high" : "medium") : "none",
    confidence,
    signal,
    reason: ok ? sanitizeReason(parsed.reason) : "",
    evidence: ok ? evidence : [],
    item: typeof parsed.item === "string" ? parsed.item : null,
    amount: typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? parsed.amount : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null
  };
}
