// Classic content script and a Node ESM side-effect module. No import/export.
// The browser judge is a tiny task on purpose: rules already decided there is a
// payment risk. The model may confirm, lower, or reject. It cannot raise.
// A later on-device model only has to answer this prompt. Chrome's Prompt API
// (LanguageModel, Gemini Nano) is the runtime when the browser has it.

const SYSTEM = "You are PayBrake's payment judge. Reply with one JSON object and no other text. Never raise the risk. Never invent a quote.";

const MESSAGE_CAP = 500;
const PROMPT_CAP = 900;

const RANK = { high: 2, medium: 1, none: 0 };

const JUDGE_IO = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }]
};

let sessionPromise = null;

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function packPrompt(text, rules) {
  const level = rules && rules.level ? rules.level : "medium";
  const signals = rules && Array.isArray(rules.signals) && rules.signals.length ? rules.signals.join(", ") : "none";
  const message = clip(text, MESSAGE_CAP);
  const body = [
    "Rules already found a payment risk. Confirm, lower, or reject it. Do not raise the level.",
    'Reply with JSON only: {"v":"confirm|lower|reject","lv":"high|medium|none","q":"verbatim quote from MESSAGE","why":"ff_deposit|ff|deposit_off|before|off|deposit|overpay|label_fee|generic"}',
    "LEVEL: " + level,
    "SIGNALS: " + signals,
    "MESSAGE:",
    message
  ].join("\n");
  return body.length <= PROMPT_CAP ? body : body.slice(0, PROMPT_CAP - 1).trimEnd() + "…";
}

function extractJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeWs(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function quoteInText(quote, input) {
  const q = normalizeWs(quote);
  if (!q) return false;
  return normalizeWs(input).includes(q);
}

function modelOff(detail) {
  const error = new Error(detail || "model_off");
  error.code = "model_off";
  return error;
}

function decide(raw, text, rules) {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") return { action: "error", reason: "bad_json" };
  const v = String(data.v || data.verdict || "").toLowerCase();
  const lv = String(data.lv || data.level || "").toLowerCase();
  const quote = data.q || data.quote || (Array.isArray(data.evidence) ? data.evidence[0] : "");
  const why = String(data.why || data.reasonId || "");
  const rulesRank = RANK[rules && rules.level] || 1;
  if (v === "reject" || lv === "none") return { action: "reject", reason: "reject" };
  if (!quoteInText(quote, text)) return { action: "reject", reason: "quote" };
  let rank = rulesRank;
  if (Object.prototype.hasOwnProperty.call(RANK, lv)) rank = Math.min(rulesRank, RANK[lv]);
  if (v === "lower") rank = Math.min(rank, rulesRank - 1);
  if (rank <= 0) return { action: "reject", reason: "lowered" };
  return {
    action: "keep",
    level: rank >= 2 ? "high" : "medium",
    why,
    quote: normalizeWs(quote)
  };
}

function languageModelApi() {
  const native = globalThis.LanguageModel;
  if (native && typeof native.create === "function") return native;
  const legacy = globalThis.ai && globalThis.ai.languageModel;
  if (legacy && typeof legacy.create === "function") return legacy;
  return null;
}

function withTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function createSession(LM) {
  const base = {
    temperature: 0,
    topK: 1,
    initialPrompts: [{ role: "system", content: SYSTEM }]
  };
  try {
    return await LM.create(Object.assign({}, base, JUDGE_IO));
  } catch {
    return LM.create({ temperature: 0, topK: 1 });
  }
}

async function browserGenerate(prompt, options = {}) {
  const LM = languageModelApi();
  if (!LM) throw modelOff("no_api");
  let availability = "available";
  try {
    if (typeof LM.availability === "function") {
      availability = await withTimeout(Promise.resolve(LM.availability(JUDGE_IO)), 500, "model_off");
    } else if (typeof LM.capabilities === "function") {
      const caps = await withTimeout(Promise.resolve(LM.capabilities()), 500, "model_off");
      const flag = caps && (caps.available || caps.languageModel);
      availability = flag === "readily" || flag === "available" ? "available" : String(flag || "unavailable");
    }
  } catch (error) {
    if (error && error.code === "model_off") throw error;
    throw modelOff("availability");
  }
  if (availability !== "available" && availability !== "readily") throw modelOff(String(availability || "unavailable"));
  if (!sessionPromise) {
    sessionPromise = Promise.resolve(createSession(LM)).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  let session;
  try {
    session = await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs || 6000);
  try {
    const result = await session.prompt(prompt, { signal: ctrl.signal });
    return typeof result === "string" ? result : String(result ?? "");
  } catch (error) {
    sessionPromise = null;
    if (session && typeof session.destroy === "function") {
      try { session.destroy(); } catch { /* session already dead */ }
    }
    if (error && error.name === "AbortError") throw Object.assign(new Error("timeout"), { code: "timeout" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function askBrowser(payload, options = {}) {
  const rules = { level: payload && payload.level, signals: payload && payload.signals };
  const prompt = payload && payload.prompt ? payload.prompt : packPrompt(payload && payload.text, rules);
  const generate = options.generate || browserGenerate;
  return generate(prompt, options);
}

globalThis.pbTinyJudge = {
  SYSTEM,
  MESSAGE_CAP,
  PROMPT_CAP,
  packPrompt,
  extractJson,
  decide,
  askBrowser,
  browserGenerate
};
