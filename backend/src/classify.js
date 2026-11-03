// LLM classify wrapper. The evidence guard is local and tested offline.
// Provider calls go through the injected fetch. Not configured → 503 llm_off
// and fetch is not called. Error text never includes the provider body.

const BANNED = /guarantee|you are protected|100%\s*safe/i;
const FALLBACK = "Risky payment request: a direct transfer may be hard to get back if the item never arrives.";
const TEXT_LIMIT = 4000;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_REFERER = "https://github.com/lamapony/paybrake";
const TYPESAFE_BASE = "https://api.typesafe.ai";
// Pinned, not the jev-latest alias: the add / clear thresholds were tuned on this version.
const TYPESAFE_MODEL = "jev-1.14.0";
const MAX_CHOICES = 255;
export const SIGNALS = ["friends_family", "upfront_deposit", "off_platform", "pay_before_see", "credential_request", "remote_access", "phishing_link", "fee_via_link", "impersonation", "account_threat", "urgency_pressure", "prize_bait", "free_bait", "other"];
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

// The AI may lower a level but must never raise it above the rules level. The extension
// already clamps locally; this is the same cap enforced on the server so a direct caller
// (or a future adapter) cannot get a higher-than-rules level out of /api/classify either.
const LEVEL_RANK = { none: 0, medium: 1, high: 2 };

export function capLevel(level, rulesLevel) {
  // Only a real rules card caps the model. "none", empty, and anything else
  // mean the rules were silent, so the model may still add a card.
  if (rulesLevel !== "medium" && rulesLevel !== "high") return level;
  const aiRank = LEVEL_RANK[level] || 0;
  return aiRank < LEVEL_RANK[rulesLevel] ? level : rulesLevel;
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

// The env var that holds the Typesafe key. Configurable so a deployment can name its secret.
function typesafeKeyName(env) {
  const name = trim(env.TYPESAFE_API_KEY_NAME);
  return /^[A-Z_][A-Z0-9_]*$/i.test(name) ? name : "TYPESAFE_API_KEY";
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

const LLM_PROVIDERS = new Set(["typesafe", "openrouter", "openai-compatible"]);

function openrouterBaseUrl(raw) {
  const value = trim(raw).replace(/\/+$/, "");
  if (!value) return OPENROUTER_BASE;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return OPENROUTER_BASE;
  }
  const host = parsed.hostname.toLowerCase();
  const onOpenRouter = host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  if (parsed.protocol !== "https:" || !onOpenRouter) return OPENROUTER_BASE;
  return value;
}

export function resolveLlm(env = {}) {
  const timeoutMs = timeoutMsOf(env);
  const asked = trim(env.LLM_PROVIDER).toLowerCase();
  if (asked === "off") return offResult(timeoutMs);
  if (asked && !LLM_PROVIDERS.has(asked)) throw new Error("Unknown LLM_PROVIDER");

  let provider = asked;
  if (!provider) {
    if (trim(env.LLM_BASE_URL)) provider = "openai-compatible";
    else if (trim(env[typesafeKeyName(env)])) provider = "typesafe";
    else if (trim(env.OPENROUTER_API_KEY)) provider = "openrouter";
    else return offResult(timeoutMs);
  }

  if (provider === "typesafe") {
    const apiKey = trim(env[typesafeKeyName(env)]);
    if (!apiKey) return offResult(timeoutMs);
    const baseUrl = (trim(env.TYPESAFE_BASE_URL) || TYPESAFE_BASE).replace(/\/+$/, "");
    const model = trim(env.TYPESAFE_MODEL) || TYPESAFE_MODEL;
    // Optional: LLM_FALLBACK=openrouter retries a failed Typesafe call on OpenRouter.
    let fallback = null;
    if (trim(env.LLM_FALLBACK).toLowerCase() === "openrouter") {
      const alt = resolveLlm({ ...env, LLM_PROVIDER: "openrouter", LLM_FALLBACK: "", LLM_BASE_URL: "", LLM_MODEL: trim(env.OPENROUTER_MODEL) });
      if (alt.configured) fallback = alt;
    }
    const add = Number(trim(env.TYPESAFE_ADD_CONFIDENCE) || "0.5");
    const addConfidence = Number.isFinite(add) ? Math.max(0.5, Math.min(1, add)) : 0.5;
    return { configured: true, provider: "typesafe", baseUrl, apiKey, model, timeoutMs, addConfidence, fallback };
  }

  if (provider === "openrouter") {
    const apiKey = trim(env.OPENROUTER_API_KEY) || trim(env.LLM_API_KEY);
    if (!apiKey) return offResult(timeoutMs);
    const baseUrl = openrouterBaseUrl(env.LLM_BASE_URL);
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

export async function classifyText(text, env = {}, fetchImpl = globalThis.fetch, rulesLevel = "") {
  const llm = resolveLlm(env);
  if (!llm.configured) throw llmError("llm_off", 503);
  const source = String(text ?? "");
  if (source.length > TEXT_LIMIT) throw badRequest("text is too long");
  const verdict = llm.provider === "typesafe"
    ? await classifyTypesafeCapped(source, llm, fetchImpl)
    : await classifyChat(source, llm, fetchImpl);
  // rulesLevel is the caller's rules card ("high" or "medium"), passed in as its own
  // argument so a request field cannot hide inside the process environment.
  // The AI can lower that level. It cannot raise it. "none" is not a cap.
  if (!verdict || verdict.level === "none") return verdict;
  const level = capLevel(verdict.level, trim(rulesLevel));
  return level === verdict.level ? verdict : { ...verdict, level };
}

async function classifyTypesafeCapped(source, llm, fetchImpl) {
  try {
    return await classifyTypesafe(source, llm, fetchImpl);
  } catch (error) {
    if (!llm.fallback) throw error;
    return classifyChat(source, llm.fallback, fetchImpl);
  }
}

// Typesafe (https://docs.typesafe.ai/api) is a decision model, not a chat model: POST
// /v1/systemone takes the chat as `state` plus typed questions and returns probabilities.
// It writes no text, so it cannot invent a quote: the evidence is the Them line it picks
// from a closed list, and the card text comes from PayBrake's own templates.
export const TYPESAFE_RISKY = {
  type: "noul",
  instructions: "This is one chat or message. Lines start with \"Them:\" (the other person: seller, caller or sender) or \"Me:\" (the PayBrake user). Judge only what Them asks for or pushes; a Me line never makes the chat risky. Is Them pushing the user toward losing money or account access?",
  criteria: {
    true: "Them asks the user to pay outside a protected checkout (bank transfer, IBAN, Friends and Family, gift cards, crypto, Zelle, Venmo, Western Union, MobilePay to a stranger), to pay a deposit or fee before getting something (delivery, customs, prize, refund, job, loan), to share card numbers, CVV, one-time or SMS codes, MitID, NemID or BankID codes or logins, passwords or ID numbers, to install a remote-access app (AnyDesk, TeamViewer), or to open a login or payment link from an unknown or lookalike site; or Them poses as a bank, authority, platform or support team to get one of these.",
    false: "Normal buying and selling, pay on pickup, platform checkout, delivery, bank or service notices without a link or fee ask, messages that tell the user never to share a code, friends chatting, plain marketing."
  }
};

export const SIGNAL_CRITERIA = {
  friends_family: "Asks to pay with PayPal Friends and Family for goods",
  upfront_deposit: "Asks for a deposit or advance payment before the deal",
  off_platform: "Asks to pay by bank transfer, IBAN, gift card, crypto, Zelle, Venmo, Western Union, MobilePay or another channel outside a protected checkout",
  pay_before_see: "Asks to pay before the user can see or get the item",
  credential_request: "Asks for card details, CVV, one-time or SMS codes, MitID, NemID or BankID, passwords, PINs or ID numbers",
  remote_access: "Asks to install or allow a remote-access or screen-sharing app",
  phishing_link: "Pushes a link to log in, verify, claim or pay on an unknown or lookalike site",
  fee_via_link: "Asks for a customs, delivery, release or processing fee, often through a link",
  impersonation: "Poses as a bank, authority, platform or support team",
  account_threat: "Threatens that an account will be locked, suspended or hacked",
  urgency_pressure: "Pushes the user to act right now",
  other: "Another kind of scam, or none of these"
};

// Extra yes/no questions for spam the "risky" question scores as plain marketing: premium-rate prize SMS
// and Discord free-bait lures. Each one can only raise p(risky), and only at or above its own bar.
// Wording and bars picked on the dev split only (eval/real/exp-typesafe-questions.mjs, RESULTS.md).
const MONEY_ASKS = ["friends_family", "upfront_deposit", "off_platform", "pay_before_see", "credential_request", "remote_access"];
const TS_ONE = "This is one chat or message. ";
export const TYPESAFE_EXTRA = {
  premium: {
    at: 0.5,
    signal: "prize_bait",
    question: { type: "noul", instructions: TS_ONE + "Does Them push the user to call or text a premium-rate number or short code (for example 09..., 087..., 0871..., or a 5-digit short code), or to sign up for a paid text service (ringtones, chat lines, adult content, quizzes) charged to the phone bill?",
      criteria: { true: "Them asks the user to call or text a premium-rate number or short code, or to subscribe to a paid text service.", false: "No premium-rate number, short code or paid text service is pushed; normal phone numbers between people." } }
  },
  prize: {
    at: 0.7,
    signal: "prize_bait",
    question: { type: "noul", instructions: TS_ONE + "Does Them tell the user they have won, been chosen for, or can claim a prize, cash, voucher, holiday, free phone or other reward, or invite them into a paid quiz or draw, and tell them to call, text or reply to a number or short code, or open a link, to get it?",
      criteria: { true: "Them announces a win, award, selection, free gift or prize draw and tells the user to call, text, reply or click to claim it.", false: "No prize or reward is claimed, or it is a friend talking about a real win, or a normal shop offer with no claim step." } }
  },
  lure: {
    at: 0.7,
    signal: "free_bait",
    question: { type: "noul", instructions: TS_ONE + "Does Them use free bait (free Nitro, a giveaway, an airdrop, free crypto or game items, a game, cheat or file to test, hidden or private channels) to get the user to click an unknown, shortened or lookalike link, join an invite, scan a QR code or download and run a file? Links to the official site of a well-known company (for example its blog or help pages) do not count.",
      criteria: { true: "Free or exclusive bait pushed through an unknown or lookalike link, invite, QR code or file.", false: "Normal chat, an official company page, a link shared for a clear reason, server rules or moderation, no free bait." } }
  }
};

function themLines(source) {
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const them = lines.filter((line) => /^Them:/.test(line)).map((line) => normalizeWs(line.slice(5)));
  // Raw text without speaker labels (a single message): every non-Me line is the sender's.
  const out = (them.length ? them : lines.filter((line) => !/^Me:/.test(line)).map(normalizeWs)).filter(Boolean);
  return out.slice(-MAX_CHOICES);
}

export function typesafeQuestions(source) {
  const lines = themLines(source);
  const questions = {
    risky: TYPESAFE_RISKY,
    ...Object.fromEntries(Object.entries(TYPESAFE_EXTRA).map(([id, x]) => [id, x.question])),
    signal: { type: "choice", instructions: "Which kind of ask from Them is the main risk in this chat?", criteria: SIGNAL_CRITERIA }
  };
  if (lines.length > 1) {
    questions.evidence = {
      type: "choice",
      instructions: "Which line from Them carries the riskiest ask?",
      criteria: Object.fromEntries(lines.map((line, i) => ["l" + i, line]))
    };
  }
  return { questions, lines };
}

async function classifyTypesafe(source, llm, fetchImpl) {
  const { questions, lines } = typesafeQuestions(source);
  let res;
  try {
    res = await fetchImpl(llm.baseUrl + "/v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({ model: llm.model, state: source, questions }),
      signal: AbortSignal.timeout(llm.timeoutMs)
    });
  } catch {
    throw llmError("llm error", 502);
  }
  if (!res.ok) {
    try { await res.text(); } catch { /* discard provider body */ }
    throw llmError(`llm ${res.status}`, 502);
  }
  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    throw llmError("llm error", 502);
  }
  const answers = body && body.answers;
  const p = Number(answers?.risky?.noul);
  if (!Number.isFinite(p)) throw llmError("llm shape", 502);
  const base = Math.max(0, Math.min(1, p));
  let prob = base;
  let bait = null; // the strongest extra question at or above its bar
  for (const [id, x] of Object.entries(TYPESAFE_EXTRA)) {
    const q = Number(answers?.[id]?.noul);
    if (!Number.isFinite(q) || q < x.at) continue;
    prob = Math.max(prob, Math.min(1, q));
    if (!bait || q > bait.q) bait = { q, signal: x.signal };
  }
  const risky = prob >= 0.5;
  const picked = answers?.evidence?.choice;
  const quote = lines.length === 1 ? lines[0] : (typeof picked === "string" && /^l\d+$/.test(picked) ? lines[Number(picked.slice(1))] : null);
  const evidence = risky && quote ? [quote] : [];
  const ok = risky && evidencePasses(evidence, source);
  let signal = SIGNALS.includes(answers?.signal?.choice) ? answers.signal.choice : (ok ? "other" : null);
  // An extra question fired: name its bait signal so the card explains a prize or free-bait scam,
  // unless the main signal is a concrete money or account ask, which says more.
  if (ok && bait && !MONEY_ASKS.includes(signal)) signal = bait.signal;
  return {
    risky: ok,
    level: ok ? (prob >= 0.9 ? "high" : "medium") : "none",
    // Confidence in the verdict given: p(risky) for "risky", 1 - p(risky) for "not risky".
    confidence: risky && !ok ? null : (risky ? prob : 1 - prob),
    signal,
    reason: "",
    evidence,
    item: null,
    amount: null,
    currency: null,
    // Picked on the dev split (eval/real/results/llm-all-v3-dev-all-typesafe-*.json sweep).
    addConfidence: llm.addConfidence,
    usage: body.usage && Number.isFinite(body.usage.input_tokens) ? { inputTokens: body.usage.input_tokens } : null
  };
}

async function classifyChat(source, llm, fetchImpl) {

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
    throw llmError("llm shape", 502);
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
