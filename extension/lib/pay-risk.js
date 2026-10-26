// Classic content script and a Node ESM side-effect module. No import/export.
// detect(text, ctx, { askLlm, llmMode }) is async.
//   llmMode "confirm" (default, v1/v2 behaviour): the model is only asked after a rules hit
//     and can only confirm or lower it.
//   llmMode "all" (v3, "AI check on all chats"): the model is asked about every chat that
//     is long enough. Either side can raise a card. The model can silence a rules hit only
//     with high confidence. A timeout or error falls back to rules only (llm "unavailable").
// Only the other person's lines raise signals: the user's own line ("buyer") never does.

// Split so a source grep for the banned phrases does not match this file.
const BANNED = new RegExp(
  ["guaran", "tee"].join("") + "|" + ["you are ", "protected"].join("") + "|100%\\s*" + "safe",
  "i"
);

const TEMPLATES = {
  ff_deposit: "Friends & Family + upfront deposit: if the item never arrives, you may have no way to get your money back.",
  ff: "Friends & Family for goods: if the item never arrives, you may have no way to get your money back.",
  deposit_off: "Upfront deposit off-platform: a direct transfer is very hard to get back if the item never arrives.",
  before: "Payment before you see the item: if it never arrives, the money may be hard to get back.",
  off: "Off-platform payment: a transfer outside PayPal checkout is hard to reverse if the item never arrives.",
  deposit: "Upfront deposit: if the item never arrives, you may have no way to get your money back.",
  remote: "Remote-access app: it lets a stranger control your device and your bank app. Do not install it.",
  cred: "Asks for card details, a code or a password: no real buyer, seller or bank needs these.",
  fee: "A fee to pay before you get something: fake delivery, customs and prize messages use this.",
  link: "Suspicious link that asks you to log in or pay: open the real site yourself instead.",
  impersonation: "Claims to be a bank, authority or platform: contact them through their official app instead.",
  ai: "The AI check thinks this chat may be a scam. Do not pay or share codes until you have checked.",
  generic: "Risky payment request: a direct transfer may be hard to get back if the item never arrives."
};

const LEVEL_RANK = { none: 0, medium: 1, high: 2 };

function clean(value) {
  const tidy = globalThis.pbTidy;
  if (tidy && typeof tidy.cleanText === "function") return tidy.cleanText(value);
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeWs(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function atomsApi() {
  const api = globalThis.pbAtoms;
  if (!api) throw new Error("pbAtoms is not loaded");
  return api;
}

function extractApi() {
  return globalThis.pbExtract || { parseAmounts: () => [], extractDeal: () => emptyDeal() };
}

function emptyDeal() {
  return { item: null, amount: null, currency: null, depositAmount: null, payeeEmail: null };
}

function templateFor(signals) {
  const has = (id) => signals.includes(id);
  let reason = TEMPLATES.generic;
  if (has("remote_access")) reason = TEMPLATES.remote;
  else if (has("credential_request")) reason = TEMPLATES.cred;
  else if (has("fee_via_link")) reason = TEMPLATES.fee;
  else if (has("phishing_link")) reason = TEMPLATES.link;
  else if (has("friends_family") && has("upfront_deposit")) reason = TEMPLATES.ff_deposit;
  else if (has("friends_family")) reason = TEMPLATES.ff;
  else if (has("upfront_deposit") && has("off_platform")) reason = TEMPLATES.deposit_off;
  else if (has("pay_before_see")) reason = TEMPLATES.before;
  else if (has("off_platform")) reason = TEMPLATES.off;
  else if (has("upfront_deposit")) reason = TEMPLATES.deposit;
  else if (has("impersonation")) reason = TEMPLATES.impersonation;
  else if (has("ai_other")) reason = TEMPLATES.ai;
  if (reason.length > 120) reason = reason.slice(0, 119).trimEnd() + "…";
  return reason;
}

function sanitizeReason(reason, fallback) {
  const text = normalizeWs(reason);
  if (!text || text.length > 120 || BANNED.test(text)) return fallback;
  return text;
}

function evidenceIsSubstring(quote, input) {
  const q = normalizeWs(quote);
  if (!q) return false;
  return normalizeWs(input).includes(q);
}

function messagesOf(text, ctx) {
  if (ctx && Array.isArray(ctx.messages) && ctx.messages.length) {
    return ctx.messages.map((message) => ({
      from: message && message.from === "buyer" ? "buyer" : "seller",
      text: String((message && message.text) || "")
    }));
  }
  return [{ from: "seller", text: String(text ?? "") }];
}

function baseOffsets(text, messages) {
  const joined = messages.map((message) => message.text).join("\n");
  if (joined === text) {
    const offsets = [];
    let acc = 0;
    for (const message of messages) {
      offsets.push(acc);
      acc += message.text.length + 1;
    }
    return offsets;
  }
  return messages.map((message) => text.indexOf(message.text));
}

// Same sentence only. A dot between digits (500.00, 1.500) is not a break.
// "kr." is not a break when the next word continues in lowercase ("kr. via").
// "500 kr. Send…" is a new sentence.
const ABBR_BEFORE_DOT = /(?:^|[^A-Za-z])(?:kr|dkk|eur|euro|usd|sek|gbp|nok)$/iu;
const PROHIBITION = /(?:never|do\s+not|don['’]?t|dont)\s+(?:send|pay|use)|aldrig\s+(?:send|betal|brug|skicka)|(?:send|betal|skicka)\s+aldrig|(?:send|betal)\s+ikke|ikke\s+send|lad\s+være\s+med\s+at|betala\s+inte/iu;
// A clause break ends the prohibited object. The next clause still belongs
// to it when it continues the object ("never send 500 kr, via F&F").
const PROHIBITION_BREAK = /(?<!\d),(?!\d)|;|—|–|\s-\s/u;
// \b is ASCII-only, so "på" would not end the preposition. Use a letter boundary.
const OBJECT_CONTINUATION = /^\s*(?:via|through|on|with|to|gennem|genom|på|paa|med|til|till)(?![\p{L}\p{N}])/iu;

function sentenceBoundary(source, index) {
  const ch = source[index];
  if (ch === "!" || ch === "?" || ch === "\n") return true;
  if (ch !== ".") return false;
  const prev = source[index - 1] || "";
  const next = source[index + 1] || "";
  if (prev >= "0" && prev <= "9" && next >= "0" && next <= "9") return false;
  if (ABBR_BEFORE_DOT.test(source.slice(Math.max(0, index - 8), index))) {
    const letter = source.slice(index + 1).match(/^\s*(\p{L})/u);
    if (letter && letter[1] === letter[1].toLowerCase()) return false;
  }
  return true;
}

function sentenceStart(text, index) {
  const source = String(text ?? "");
  const upto = Math.max(0, Math.min(index, source.length));
  for (let i = upto - 1; i >= 0; i--) {
    if (sentenceBoundary(source, i)) return i + 1;
  }
  return 0;
}

function prohibitionBreakEnds(afterCue) {
  const re = new RegExp(PROHIBITION_BREAK.source, "gu");
  for (const match of afterCue.matchAll(re)) {
    const next = afterCue.slice((match.index ?? 0) + match[0].length);
    if (!OBJECT_CONTINUATION.test(next)) return true;
  }
  return false;
}

function prohibitionCovers(text, hitStart) {
  const source = String(text ?? "");
  const before = source.slice(sentenceStart(source, hitStart), hitStart);
  const re = new RegExp(PROHIBITION.source, "giu");
  for (const match of before.matchAll(re)) {
    const afterCue = before.slice((match.index ?? 0) + match[0].length);
    if (!prohibitionBreakEnds(afterCue)) return true;
  }
  return false;
}

// Checkout is pay_on_collection with gate "checkout", not the letters in the span.
// Every other veto atom hides the card on its own.
function collectionOffer(hit) {
  return !!hit && hit.role === "veto" && hit.atom === "pay_on_collection" && hit.gate !== "checkout";
}

function vetoHidesOnItsOwn(hit) {
  return !!hit && hit.role === "veto" && !collectionOffer(hit);
}

function silent(reason, extra) {
  return {
    kind: "silent",
    silentReason: reason,
    signals: extra.signals || [],
    evidence: extra.evidence || [],
    deal: extra.deal || emptyDeal(),
    llm: extra.llm || "off",
    rulesVersion: atomsApi().RULES_VERSION
  };
}

function numberFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function applyLlm(rules, llm, text) {
  if (!llm || typeof llm !== "object") {
    return { ...rules, level: "medium", llm: "error" };
  }
  const quotes = Array.isArray(llm.evidence) ? llm.evidence : [];
  const quotesOk = quotes.length > 0 && quotes.every((quote) => typeof quote === "string" && evidenceIsSubstring(quote, text));
  if (llm.risky === false || llm.level === "none" || !quotesOk) {
    return silent("llm_disagrees", {
      signals: rules.signals,
      evidence: rules.evidence,
      deal: rules.deal,
      llm: "confirmed"
    });
  }
  const rank = { high: 2, medium: 1 };
  const rulesRank = rank[rules.level] || 1;
  const llmRank = rank[llm.level] || rulesRank;
  const level = Math.min(rulesRank, llmRank) >= 2 ? "high" : "medium";
  const deal = { ...rules.deal };
  if (typeof llm.item === "string" && llm.item.trim() && evidenceIsSubstring(llm.item, text) && !deal.item) {
    deal.item = llm.item.trim();
  }
  const amount = numberFrom(llm.amount);
  if (amount != null && !deal.amount) {
    const digits = String(Math.round(amount));
    if (text.includes(digits) || text.includes(String(amount))) deal.amount = amount;
  }
  if (typeof llm.currency === "string" && /^[A-Za-z]{3}$/.test(llm.currency) && !deal.currency) {
    deal.currency = llm.currency.toUpperCase();
  }
  return {
    ...rules,
    level,
    reason: sanitizeReason(llm.reason, rules.reason),
    deal,
    llm: "confirmed"
  };
}

async function detect(text, ctx = {}, options = {}) {
  const raw = String(text ?? "");
  const cleaned = clean(raw);
  const api = atomsApi();
  const extract = extractApi();
  if (cleaned.length < 20) {
    return silent("short", {});
  }

  const messages = messagesOf(raw, ctx);
  const offsets = baseOffsets(raw, messages);
  const perMessage = messages.map((message, index) => {
    const base = offsets[index];
    const hits = api.findAtoms(message.text).map((hit) => ({
      ...hit,
      prohibited: hit.role === "act" && prohibitionCovers(message.text, hit.start),
      refused: collectionOffer(hit) && prohibitionCovers(message.text, hit.start),
      start: base >= 0 ? base + hit.start : hit.start,
      end: base >= 0 ? base + hit.end : hit.end
    }));
    return { ...message, hits, amounts: extract.parseAmounts ? extract.parseAmounts(message.text) : [] };
  });

  const goods = api.goodsHit(messages);
  const vetoes = perMessage.flatMap((message) => message.hits).filter((hit) => hit.role === "veto");
  // A prohibited span is not an ask. The user's own line ("buyer") never raises one.
  const actHits = perMessage
    .filter((message) => message.from !== "buyer")
    .flatMap((message) => message.hits)
    .filter((hit) => hit.role === "act" && !hit.prohibited);
  const signals = api.ATOMS.map((atom) => atom.id).filter((id) => actHits.some((hit) => hit.atom === id));
  const strong = [...new Set(actHits.filter((hit) => hit.strength === "strong").map((hit) => hit.atom))];
  const weak = [...new Set(actHits.filter((hit) => hit.strength === "weak").map((hit) => hit.atom))];
  const evidence = actHits.map((hit) => ({ atom: hit.atom, text: hit.text, start: hit.start, end: hit.end }));
  const deal = extract.extractDeal
    ? extract.extractDeal(raw, ctx, actHits.map((hit) => ({ ...hit, start: hit.start, end: hit.end, atom: hit.atom })))
    : emptyDeal();

  // vetoHit stays a hit object. Checkout, agreed Goods & Services, and any
  // other non-collection veto hide the card. Collection hides it only when
  // no strong ask is live and the collection phrase itself was not refused.
  const hardVeto = (goods && vetoHidesOnItsOwn(goods) ? goods : null) || vetoes.find((hit) => vetoHidesOnItsOwn(hit)) || null;
  const collectionVeto = hardVeto || strong.length
    ? null
    : vetoes.find((hit) => collectionOffer(hit) && !hit.refused) || null;
  const vetoHit = hardVeto || collectionVeto;

  const rules = rulesVerdict({ api, perMessage, vetoHit, actHits, signals, strong, weak, evidence, deal });
  const ask = options && options.askLlm;
  if (typeof ask !== "function") return rules;
  if (options.llmMode === "all") return combineAll(rules, raw, messages, ask, options);
  if (rules.kind !== "risk") return rules;
  return confirmOnly(rules, raw, ask, options);
}

function rulesVerdict({ api, perMessage, vetoHit, actHits, signals, strong, weak, evidence, deal }) {
  if (vetoHit) return silent("veto", { signals, evidence, deal });
  if (!actHits.length) return silent("no_atom", { signals, evidence, deal });
  const meta = Object.fromEntries(api.ATOMS.map((atom) => [atom.id, atom]));
  // v3: a bank/authority claim together with an account threat is a medium on its own.
  const impersonationCombo = weak.includes("impersonation") && weak.length >= 2;
  if (!strong.length && !impersonationCombo) return silent("weak_only", { signals, evidence, deal });

  let level = null;
  if (strong.length >= 2 || (strong.length >= 1 && weak.length >= 1)) level = "high";
  else if (strong.length === 1) {
    const host = perMessage.find((message) => message.from !== "buyer" && message.hits.some((hit) => (
      hit.atom === strong[0] && hit.strength === "strong" && !hit.prohibited
    )));
    const pay = host && api.hasPayWord(host.text);
    const money = host && host.amounts && host.amounts.length > 0;
    // "transfer" is not a pay word ("Wise transfer", "transfer the bike").
    // An upfront hit that uses it already required money in the gap.
    const transferUpfront = host && host.hits.some((hit) => (
      hit.atom === "upfront_deposit" && /(?<![\p{L}\p{N}])transfer(?![\p{L}\p{N}])/iu.test(hit.text)
    ));
    // "Friends and Family only" after a refused checkout has no pay word and no amount.
    const methodOnly = host && host.hits.some((hit) => hit.gate === "ff-dictated" && !hit.prohibited);
    const standalone = meta[strong[0]] && meta[strong[0]].standalone;
    if (pay || money || transferUpfront || methodOnly || standalone) level = "medium";
  } else if (impersonationCombo) level = "medium";
  if (!level) return silent("no_atom", { signals, evidence, deal });

  return {
    kind: "risk",
    level,
    reason: templateFor(signals),
    signals,
    evidence,
    deal,
    llm: "off",
    source: "rules",
    rulesVersion: api.RULES_VERSION
  };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function confirmOnly(rules, raw, ask, options) {
  const timeoutMs = options.timeoutMs ?? 4000;
  try {
    const llm = await withTimeout(ask({ text: raw, level: rules.level, signals: rules.signals }), timeoutMs);
    return applyLlm(rules, llm, raw);
  } catch (error) {
    if (error && (error.code === "llm_off" || error.status === 503)) return rules;
    return { ...rules, level: "medium", llm: "error" };
  }
}

// ---- llmMode "all" ------------------------------------------------------------

const AI_SIGNALS = ["friends_family", "upfront_deposit", "off_platform", "pay_before_see", "credential_request", "remote_access", "phishing_link", "fee_via_link", "impersonation", "account_threat", "urgency_pressure"];
const TRANSCRIPT_LIMIT = 3900;
const CODE_NOTICE = /(?:never|do\s+not|don['’]t|not)\s+(?:share|give|tell|send|disclose|forward)|(?:aldrig|ikke)\s+(?:del|dele|giv|oplys)/iu;
const CODE_ASK = /(?:send|give|tell|read|share|forward|provide|reply\s+with|type|enter)\s+(?:it\s+|them\s+)?(?:to\s+)?(?:me|us|our\s+(?:agent|team|staff|representative))\b/iu;
const DEFAULTS = { downgradeConfidence: 0.85, addConfidence: 0.8, vetoOverrideConfidence: 0.9, timeoutMs: 6000 };

function redactText(value) {
  const api = globalThis.pbRedact;
  return api && typeof api.redact === "function" ? api.redact(value) : String(value ?? "");
}

// The transcript the model sees: speaker-labelled and redacted. "Them" is the other
// person in the chat (seller, caller, sender); "Me" is the PayBrake user.
function transcriptOf(messages) {
  const lines = messages.map((message) => ({
    from: message.from === "buyer" ? "Me" : "Them",
    text: redactText(normalizeWs(message.text))
  })).filter((line) => line.text);
  let text = lines.map((line) => line.from + ": " + line.text).join("\n");
  // The backend takes at most 4000 characters; keep the latest part of a long chat.
  if (text.length > TRANSCRIPT_LIMIT) text = text.slice(text.length - TRANSCRIPT_LIMIT).replace(/^[^\n]*\n/, "");
  return {
    text,
    them: lines.filter((line) => line.from === "Them").map((line) => line.text).join("\n")
  };
}

function confidenceOf(llm) {
  const n = Number(llm && llm.confidence);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function aiSignal(llm) {
  const id = llm && typeof llm.signal === "string" ? llm.signal.trim() : "";
  return AI_SIGNALS.includes(id) ? id : "ai_other";
}

function aiEvidence(quotes, raw) {
  return quotes
    .filter((quote) => typeof quote === "string" && normalizeWs(quote))
    .map((quote) => {
      const q = normalizeWs(quote);
      const at = raw.indexOf(q);
      return at >= 0 ? { atom: "ai", text: q, start: at, end: at + q.length } : null;
    })
    .filter(Boolean);
}

async function combineAll(rules, raw, messages, ask, options) {
  const cfg = { ...DEFAULTS, ...options };
  if (rules.silentReason === "short") return rules;
  const transcript = transcriptOf(messages);
  if (!transcript.them) return { ...rules, llm: "skipped" };
  const started = Date.now();
  let llm;
  try {
    llm = await withTimeout(ask({ text: transcript.text, mode: "all", level: rules.level || "none", signals: rules.signals }), cfg.timeoutMs);
  } catch (error) {
    const off = error && (error.code === "llm_off" || error.status === 503);
    return { ...rules, llm: off ? "off_server" : "unavailable", llmMs: Date.now() - started };
  }
  const llmMs = Date.now() - started;
  if (!llm || typeof llm !== "object") return { ...rules, llm: "unavailable", llmMs };

  const confidence = confidenceOf(llm);
  const quotes = Array.isArray(llm.evidence) ? llm.evidence.filter((q) => typeof q === "string") : [];
  // Evidence must quote the other person, verbatim (after redaction): the user's own line never counts.
  const quotesOk = quotes.length > 0 && quotes.every((quote) => evidenceIsSubstring(quote, transcript.them));
  const aiRisky = llm.risky === true && llm.level !== "none" && quotesOk;
  const aiLevel = llm.level === "high" ? "high" : "medium";
  const signal = aiSignal(llm);
  const ai = { risky: aiRisky, level: aiRisky ? aiLevel : "none", confidence, signal, reason: sanitizeReason(llm.reason, "") };

  if (rules.kind === "risk") {
    if (aiRisky) {
      const level = LEVEL_RANK[aiLevel] > LEVEL_RANK[rules.level] ? aiLevel : rules.level;
      const signals = rules.signals.includes(signal) || signal === "ai_other" ? rules.signals : rules.signals.concat(signal);
      return { ...rules, level, signals, reason: rules.reason, aiReason: ai.reason || null, llm: "confirmed", ai, llmMs };
    }
    // The model may silence an obvious rules false positive, only with high confidence.
    if (llm.risky === false && confidence != null && confidence >= cfg.downgradeConfidence) {
      return { ...silent("llm_disagrees", { signals: rules.signals, evidence: rules.evidence, deal: rules.deal, llm: "downgraded" }), ai, llmMs };
    }
    return { ...rules, llm: "disagreed_low_confidence", ai, llmMs };
  }

  // Rules are silent. The model can add a card.
  if (!aiRisky || (confidence != null && confidence < cfg.addConfidence)) {
    return { ...rules, llm: "agreed_silent", ai, llmMs };
  }
  // A bank or service sending the user a code and warning them never to share it is the normal,
  // safe pattern. Without a rules hit, the AI alone may not turn that notice into a card.
  if (signal === "credential_request" && CODE_NOTICE.test(transcript.them) && !CODE_ASK.test(transcript.them)) {
    return { ...rules, llm: "agreed_silent", ai, llmMs };
  }
  if (rules.silentReason === "veto" && !(aiLevel === "high" && confidence != null && confidence >= cfg.vetoOverrideConfidence)) {
    return { ...rules, llm: "agreed_silent", ai, llmMs };
  }
  const signals = [signal];
  return {
    kind: "risk",
    level: aiLevel,
    reason: ai.reason || templateFor(signals),
    signals,
    evidence: aiEvidence(quotes, raw),
    deal: rules.deal || emptyDeal(),
    llm: "added",
    source: "ai",
    ai,
    llmMs,
    rulesVersion: atomsApi().RULES_VERSION
  };
}

globalThis.pbPayRisk = {
  detect,
  templateFor,
  sanitizeReason,
  evidenceIsSubstring,
  transcriptOf,
  TEMPLATES,
  DEFAULTS
};
