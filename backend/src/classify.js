// LLM classify wrapper. The evidence guard is local and tested offline.
// Provider calls go through the injected fetch. Not configured → 503 llm_off
// and fetch is not called. Error text never includes the provider body.

const BANNED = /guarantee|you are protected|100%\s*safe/i;
const FALLBACK = "Risky payment request: a direct transfer may be hard to get back if the item never arrives.";
const TEXT_LIMIT = 4000;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_REFERER = "https://github.com/lamapony/paybrake";
const SYSTEM = "You judge whether a marketplace chat asks for a risky payment. Reply with JSON only: {risky:boolean, level:\"high\"|\"medium\"|\"none\", reason:string<=120, evidence:string[], item:string|null, amount:number|null, currency:string|null}. Every evidence string must be a verbatim substring of the user text. Do not promise a refund.";

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
  return {
    risky: ok,
    level: ok ? (parsed.level === "high" ? "high" : "medium") : "none",
    reason: ok ? sanitizeReason(parsed.reason) : "",
    evidence: ok ? evidence : [],
    item: typeof parsed.item === "string" ? parsed.item : null,
    amount: typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? parsed.amount : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null
  };
}
