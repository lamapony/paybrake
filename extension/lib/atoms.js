// Classic content script and a Node ESM side-effect module. No import/export.
// Load order in the extension: brand.js, tidy.js, atoms.js, extract.js, pay-risk.js.
// Patterns are case-insensitive and Unicode-aware. A hit is a concrete span.

const RULES_VERSION = 1;

function wordBound(pattern, flags = "giu") {
  const tidy = globalThis.pbTidy;
  if (tidy && typeof tidy.wordBound === "function") return tidy.wordBound(pattern, flags);
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, flags);
}

const PAY_WORD = wordBound("send|pay|paid|payment|paying|via|paypal|betal|betale|betaling|overfør|overfører|overfoer", "iu");

const ATOMS = [
  { id: "friends_family", role: "act", strength: "strong", receipt: "Friends & Family" },
  { id: "upfront_deposit", role: "act", strength: "strong", receipt: "Upfront deposit" },
  { id: "off_platform", role: "act", strength: "strong", receipt: "Off-platform payment" },
  { id: "pay_before_see", role: "act", strength: "strong", receipt: "Pay before seeing the item" },
  { id: "urgency_pressure", role: "act", strength: "weak", receipt: "Pressure to hurry" },
  { id: "ship_before_meet", role: "act", strength: "weak", receipt: "Ships before you meet" },
  { id: "pay_on_collection", role: "veto", strength: "veto", receipt: "Pay on collection or checkout" },
  { id: "goods_and_services_agreed", role: "veto", strength: "veto", receipt: "Goods & Services agreed" }
];

const META = Object.fromEntries(ATOMS.map((atom) => [atom.id, atom]));

const RULES = [
  { id: "friends_family", re: "friends\\s+(?:and|&)\\s+family", gate: "ff-phrase" },
  { id: "friends_family", re: "venner\\s+(?:og|&)\\s+familie", gate: "ff-phrase" },
  { id: "friends_family", re: "F&F", gate: "none" },
  { id: "friends_family", re: "FnF", gate: "none" },
  { id: "friends_family", re: "family\\s+(?:and|&)\\s+friends", gate: "ff-phrase" },
  { id: "friends_family", re: "familie\\s+(?:og|&)\\s+venner", gate: "ff-phrase" },
  { id: "friends_family", re: "friends\\s*/\\s*family", gate: "ff-phrase" },
  { id: "friends_family", re: "F\\s+&\\s+F", gate: "none" },
  { id: "friends_family", re: "send\\s+as\\s+gift", gate: "none" },
  { id: "friends_family", re: "personal\\s+(?:paypal\\s+)?payment", gate: "none" },

  { id: "upfront_deposit", re: "hold\\s+it\\s+for\\s+you", gate: "deposit-specific" },
  { id: "upfront_deposit", re: "holder[^\\n]{0,40}?til\\s+dig", gate: "deposit-specific" },
  { id: "upfront_deposit", re: "reservation\\s+fee", gate: "deposit-specific" },
  { id: "upfront_deposit", re: "pay\\s+half\\s+now", gate: "deposit-specific" },
  { id: "upfront_deposit", re: "deposits?", gate: "deposit-word" },
  { id: "upfront_deposit", re: "depositum", gate: "deposit-word" },
  { id: "upfront_deposit", re: "forudbetaling", gate: "deposit-word" },
  { id: "upfront_deposit", re: "forskud", gate: "deposit-word" },
  { id: "upfront_deposit", re: "reserver(?:e|er|ing)?", gate: "reserve" },

  { id: "off_platform", re: "mobile\\s*pay", gate: "mobilepay" },
  { id: "off_platform", re: "IBAN", gate: "iban" },
  { id: "off_platform", re: "[A-Za-z]{2}\\d{2}[A-Za-z0-9]{11,30}", gate: "iban", flags: "g" },
  { id: "off_platform", re: "bank\\s+transfers?", gate: "negation" },
  { id: "off_platform", re: "wire\\s+transfers?", gate: "negation" },
  { id: "off_platform", re: "bankoverførsel", gate: "negation" },
  { id: "off_platform", re: "reg\\.?\\s*nr", gate: "negation" },
  { id: "off_platform", re: "registreringsnummer", gate: "negation" },
  { id: "off_platform", re: "konto\\s*nr\\.?", gate: "negation" },
  { id: "off_platform", re: "kontonummer", gate: "negation" },
  { id: "off_platform", re: "kontonr", gate: "negation" },
  { id: "off_platform", re: "account\\s+numbers?", gate: "negation" },
  { id: "off_platform", re: "sort\\s+codes?", gate: "negation" },
  { id: "off_platform", re: "revolut", gate: "negation" },
  { id: "off_platform", re: "(?:transferwise|wise\\.com|\\b(?:via|on|with|til|through|på)\\s+wise\\b|\\bwise\\s+transfer\\b)", gate: "negation" },
  { id: "off_platform", re: "bitcoin|bitcoins|\\bbtc\\b|ethereum|\\busdt\\b|crypto(?:currency)?", gate: "negation" },
  { id: "off_platform", re: "gift\\s*cards?|gavekort", gate: "negation" },
  { id: "off_platform", re: "(?:pay|send|betal)\\s+(?:me\\s+)?(?:on|via|på)\\s+(?:whatsapp|telegram)", gate: "none" },
  { id: "off_platform", re: "paypal\\.me/\\S+", gate: "none" },

  { id: "pay_before_see", re: "pay(?:ment)?\\s+first", gate: "none" },
  { id: "pay_before_see", re: "betal\\s+først", gate: "none" },
  { id: "pay_before_see", re: "payment\\s+before\\s+(?:viewing|seeing|you\\s+see)", gate: "none" },
  { id: "pay_before_see", re: "pay\\s+before\\s+(?:you\\s+)?(?:see|view|viewing|meeting)", gate: "none" },

  { id: "urgency_pressure", re: "several\\s+people(?:\\s+are)?\\s+asking", gate: "none" },
  { id: "urgency_pressure", re: "others?\\s+are\\s+interested", gate: "none" },
  { id: "urgency_pressure", re: "today\\s+only", gate: "none" },
  { id: "urgency_pressure", re: "only\\s+today", gate: "none" },
  { id: "urgency_pressure", re: "first\\s+to\\s+pay", gate: "none" },
  { id: "urgency_pressure", re: "within\\s+the\\s+hour", gate: "none" },
  { id: "urgency_pressure", re: "mange\\s+(?:er\\s+)?interesserede", gate: "none" },
  { id: "urgency_pressure", re: "flere\\s+(?:er\\s+)?interesserede", gate: "none" },
  { id: "urgency_pressure", re: "først\\s+til\\s+mølle", gate: "none" },
  { id: "urgency_pressure", re: "a\\s+lot\\s+of\\s+people", gate: "none" },

  { id: "ship_before_meet", re: "I\\s+ship\\s+tomorrow", gate: "ship" },
  { id: "ship_before_meet", re: "can\\s+only\\s+ship", gate: "ship" },
  { id: "ship_before_meet", re: "only\\s+shipping", gate: "ship" },
  { id: "ship_before_meet", re: "shipping\\s+only", gate: "ship" },
  { id: "ship_before_meet", re: "I(?:'m|\\s+am)\\s+abroad", gate: "ship" },
  { id: "ship_before_meet", re: "courier\\s+delivers?\\s+after\\s+payment", gate: "ship" },
  { id: "ship_before_meet", re: "kan\\s+kun\\s+sende", gate: "ship" },
  { id: "ship_before_meet", re: "kun\\s+forsendelse", gate: "ship" },

  { id: "pay_on_collection", re: "pay\\s+when\\s+you\\s+pick(?:\\s+it\\s+up)?", gate: "none" },
  { id: "pay_on_collection", re: "when\\s+you\\s+pick(?:\\s+it\\s+up)?", gate: "none" },
  { id: "pay_on_collection", re: "cash\\s+on\\s+(?:pick\\s*up|collection)", gate: "none" },
  { id: "pay_on_collection", re: "cash\\s+when\\s+you\\s+pick", gate: "none" },
  { id: "pay_on_collection", re: "pay\\s+on\\s+(?:pick\\s*up|collection)", gate: "none" },
  { id: "pay_on_collection", re: "on\\s+pick\\s*up", gate: "none" },
  { id: "pay_on_collection", re: "at\\s+pick\\s*up", gate: "none" },
  { id: "pay_on_collection", re: "betal(?:ing)?\\s+ved\\s+afhentning", gate: "none" },
  { id: "pay_on_collection", re: "ved\\s+afhentning", gate: "none" },
  { id: "pay_on_collection", re: "når\\s+du\\s+henter", gate: "none" },
  { id: "pay_on_collection", re: "through\\s+the\\s+(?:\\w+\\s+){0,3}checkout", gate: "none" },
  { id: "pay_on_collection", re: "(?:the|platform(?:ens)?|marketplace)\\s+checkout", gate: "none" },
  { id: "pay_on_collection", re: "brug\\s+(?:platformens\\s+)?checkout", gate: "none" }
];

const GS = wordBound("goods\\s*(?:&|and)\\s*services|varer\\s+og\\s+tjenester|G&S", "iu");
const PICKUP_ALT = /or\s+you\s+can\s+pick|or\s+pick\s*up|ship\s+or\s+(?:you\s+can\s+)?pick|eller\s+(?:du\s+kan\s+)?(?:hente|afhent)/iu;
const REFUSAL = /(?:no|not|don't|dont|do\s+not|won't|wont|ikke|nej)\s+(?:\w+\s+){0,4}(?:goods(?:\s*(?:&|and)\s*services)?|g&s|varer\s+og\s+tjenester)/iu;

function hasPayWord(text) {
  PAY_WORD.lastIndex = 0;
  return PAY_WORD.test(String(text ?? ""));
}

function payWordNear(text, start, end, window) {
  const slice = text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
  return hasPayWord(slice);
}

function negatedBefore(text, start) {
  const before = text.slice(Math.max(0, start - 28), start);
  return /(?:no|not|don't|dont|never|without|ingen|uden|ikke|nej)\s+$/iu.test(before);
}

function amountSpans(text) {
  const extract = globalThis.pbExtract;
  if (extract && typeof extract.parseAmounts === "function") return extract.parseAmounts(text);
  return [];
}

function amountNear(text, start, end, window) {
  return amountSpans(text).some((amount) => {
    const gap = amount.end <= start ? start - amount.end : amount.start >= end ? amount.start - end : 0;
    return gap <= window;
  });
}

function phoneNear(text, start, end) {
  const slice = text.slice(Math.max(0, start - 48), Math.min(text.length, end + 48));
  return /\+?\d[\d\s]{6,}\d/.test(slice);
}

function depositRejected(text, start, end) {
  const before = text.slice(Math.max(0, start - 48), start);
  const after = text.slice(end, Math.min(text.length, end + 40));
  if (/(?:no|ingen|uden|without)\s+$/iu.test(before)) return true;
  if (/bottle\s+$/iu.test(before)) return true;
  if (/return\s+them\s+for\s+(?:the\s+)?$/iu.test(before)) return true;
  if (/^\s*(?:on\s+collection|when\s+you\s+(?:pick|collect)|ved\s+afhentning)/iu.test(after)) return true;
  return false;
}

function allow(rule, text, start, end) {
  if (rule.gate === "none" || rule.gate === "deposit-specific") return !negatedBefore(text, start);
  if (rule.gate === "negation") return !negatedBefore(text, start);
  if (rule.gate === "ff-phrase") return payWordNear(text, start, end, 60);
  if (rule.gate === "deposit-word") {
    if (depositRejected(text, start, end)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
  }
  if (rule.gate === "reserve") {
    if (depositRejected(text, start, end)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
  }
  if (rule.gate === "iban") return payWordNear(text, start, end, 80);
  if (rule.gate === "mobilepay") {
    if (phoneNear(text, start, end)) return true;
    return hasPayWord(text) && amountSpans(text).length > 0;
  }
  if (rule.gate === "ship") {
    if (PICKUP_ALT.test(text)) return false;
    return true;
  }
  return true;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function findAtoms(text) {
  const source = String(text ?? "");
  const found = [];
  for (const rule of RULES) {
    const flags = rule.flags || "giu";
    const re = wordBound(rule.re, flags.includes("g") ? flags : flags + "g");
    for (const match of source.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!allow(rule, source, start, end)) continue;
      const meta = META[rule.id];
      found.push({
        atom: rule.id,
        text: match[0],
        start,
        end,
        role: meta.role,
        strength: meta.strength,
        receipt: meta.receipt
      });
    }
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const hit of found) {
    const clash = kept.find((other) => other.atom === hit.atom && overlaps(other, hit));
    if (!clash) kept.push(hit);
  }
  return kept;
}

function goodsHit(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const buyer = list.filter((m) => m && m.from === "buyer");
  const seller = list.filter((m) => m && m.from !== "buyer");
  const buyerProposed = buyer.some((m) => GS.test(String(m.text || "")));
  GS.lastIndex = 0;
  for (const message of seller) {
    const body = String(message.text || "");
    GS.lastIndex = 0;
    const offers = GS.test(body);
    GS.lastIndex = 0;
    if (offers && !REFUSAL.test(body)) {
      const match = body.match(wordBound("goods\\s*(?:&|and)\\s*services|varer\\s+og\\s+tjenester|G&S", "iu"));
      const start = match ? match.index : 0;
      const phrase = match ? match[0] : "Goods & Services";
      return { atom: "goods_and_services_agreed", text: phrase, start, end: start + phrase.length, role: "veto", strength: "veto", receipt: META.goods_and_services_agreed.receipt };
    }
    if (buyerProposed && /^(?:yes|sure|ok|okay|ja|gerne|agreed|sounds good|det er fint|det kan vi)\b/iu.test(body.trim()) && !REFUSAL.test(body)) {
      return { atom: "goods_and_services_agreed", text: body.trim().slice(0, 40), start: 0, end: Math.min(40, body.length), role: "veto", strength: "veto", receipt: META.goods_and_services_agreed.receipt };
    }
  }
  if (!list.length) return null;
  return null;
}

globalThis.pbAtoms = {
  RULES_VERSION,
  ATOMS,
  PAY_WORD,
  findAtoms,
  hasPayWord,
  goodsHit
};
