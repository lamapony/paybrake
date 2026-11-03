// Classic content script and a Node ESM side-effect module. No import/export.
// detect(text, ctx, { askLlm }) is async. The model can only confirm or lower a
// rules hit. It is not called on short, no_atom, weak_only, or veto.

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
  generic: "Risky payment request: a direct transfer may be hard to get back if the item never arrives."
};

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
  if (has("friends_family") && has("upfront_deposit")) reason = TEMPLATES.ff_deposit;
  else if (has("friends_family")) reason = TEMPLATES.ff;
  else if (has("upfront_deposit") && has("off_platform")) reason = TEMPLATES.deposit_off;
  else if (has("pay_before_see")) reason = TEMPLATES.before;
  else if (has("off_platform")) reason = TEMPLATES.off;
  else if (has("upfront_deposit")) reason = TEMPLATES.deposit;
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
  // A prohibited span is not an ask. It does not open a card, and it does not
  // count as the strong ask that would stop a collection offer from hiding one.
  const actHits = perMessage.flatMap((message) => message.hits).filter((hit) => hit.role === "act" && !hit.prohibited);
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
  if (vetoHit) return silent("veto", { signals, evidence, deal });
  if (!actHits.length) return silent("no_atom", { signals, evidence, deal });
  if (!strong.length) return silent("weak_only", { signals, evidence, deal });

  let level = null;
  if (strong.length >= 2 || (strong.length >= 1 && weak.length >= 1)) level = "high";
  else if (strong.length === 1) {
    const host = perMessage.find((message) => message.hits.some((hit) => (
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
    if (pay || money || transferUpfront || methodOnly) level = "medium";
  }
  if (!level) return silent("no_atom", { signals, evidence, deal });

  const rules = {
    kind: "risk",
    level,
    reason: templateFor(signals),
    signals,
    evidence,
    deal,
    llm: "off",
    rulesVersion: api.RULES_VERSION
  };

  const ask = options && options.askLlm;
  if (typeof ask !== "function") return rules;

  const timeoutMs = options.timeoutMs ?? 4000;
  let timer;
  try {
    const llm = await Promise.race([
      Promise.resolve(ask({ text: raw, level: rules.level, signals: rules.signals })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), timeoutMs);
      })
    ]);
    return applyLlm(rules, llm, raw);
  } catch (error) {
    if (error && (error.code === "llm_off" || error.status === 503)) return rules;
    return { ...rules, level: "medium", llm: "error" };
  } finally {
    clearTimeout(timer);
  }
}

globalThis.pbPayRisk = {
  detect,
  templateFor,
  sanitizeReason,
  evidenceIsSubstring,
  TEMPLATES
};
