// LLM classify wrapper. The evidence guard is local and tested offline.
// Provider calls go through the injected fetch. /api/classify returns 503
// llm_off when LLM_BASE_URL is empty, before this function is used.

const BANNED = /guarantee|you are protected|100%\s*safe/i;
const FALLBACK = "Risky payment request: a direct transfer may be hard to get back if the item never arrives.";

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

function llmError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  error.code = status === 503 ? "llm_off" : "llm_error";
  return error;
}

export async function classifyText(text, env = {}, fetchImpl = globalThis.fetch) {
  const base = String(env.LLM_BASE_URL || "").trim();
  if (!base) throw llmError("llm_off", 503);
  const source = String(text ?? "");
  const res = await fetchImpl(base.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: env.LLM_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You judge whether a marketplace chat asks for a risky payment. Reply with JSON only: {risky:boolean, level:\"high\"|\"medium\"|\"none\", reason:string<=120, evidence:string[], item:string|null, amount:number|null, currency:string|null}. Every evidence string must be a verbatim substring of the user text. Do not promise a refund."
        },
        { role: "user", content: source }
      ]
    })
  });
  const raw = await res.text();
  if (!res.ok) throw llmError(`llm ${res.status}: ${raw.slice(0, 160)}`);
  let parsed;
  try {
    const body = JSON.parse(raw);
    const content = body?.choices?.[0]?.message?.content ?? body;
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    throw llmError("llm returned non-JSON: " + raw.slice(0, 160));
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
