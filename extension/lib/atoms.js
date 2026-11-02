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

const PAY_WORD = wordBound("send|pay|paid|payment|paying|via|paypal|betal|betale|betala|betaling|skicka|skickar|overfør|overfører|overfoer", "iu");

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

// Words between the pay cue and upfront / in advance. A period ends the
// sentence, except inside a dotted amount (1.500, $12.50) or abbreviation (e.g.).
const GAP_TOKEN = "(?:\\$?\\d+(?:[.,]\\d+)+|(?:[A-Za-z]\\.){2,}|[^\\s.!?\\n]+)";
const SPAN_GAP = `[ \\t]+(?:${GAP_TOKEN}[ \\t]+){0,8}`;
const UP_FRONT = "up[ \\t]*front";
const PAY_CUE = "(?:paid|pay(?:ing|ment)?|send|transfer)[:,;]?";
// Reversed "upfront payment" only. A wide gap treats "to be upfront" and
// "the light up front" as a deposit when "pay" shows up later in the line.
const REVERSE_GAP = "[ \\t]+";

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
  { id: "upfront_deposit", re: `${PAY_CUE}${SPAN_GAP}${UP_FRONT}`, gate: "upfront-window" },
  { id: "upfront_deposit", re: `${PAY_CUE}${SPAN_GAP}in[ \\t]+advance(?!\\s+of\\b)`, gate: "upfront-window" },
  { id: "upfront_deposit", re: `${UP_FRONT}${REVERSE_GAP}${PAY_CUE}`, gate: "upfront-window" },
  { id: "upfront_deposit", re: "holding\\s+fee", gate: "deposit-word", spanNegation: true },
  { id: "upfront_deposit", re: "to\\s+reserve\\s+(?:the\\s+bike|it)", gate: "reserve", spanNegation: true },

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
  { id: "off_platform", re: "(?:pay|send|betal)\\s+(?:me\\s+)?(?:\\S+\\s+){0,3}\\b(?:on|via|på)\\s+(?:whatsapp|telegram)", gate: "chat-pay" },
  { id: "off_platform", re: "paypal\\.me/\\S+", gate: "none" },
  { id: "off_platform", re: "\\bwestern\\s+union\\b", gate: "named-rail" },
  { id: "off_platform", re: "\\bmoneygram\\b", gate: "named-rail" },
  { id: "off_platform", re: "\\bvenmo\\b", gate: "named-rail" },
  { id: "off_platform", re: "\\bzelle\\b", gate: "named-rail" },
  { id: "off_platform", re: "\\bcash\\s*app\\b", gate: "named-rail" },
  { id: "off_platform", re: "\\$[a-z][a-z0-9_]{1,19}", gate: "cashtag" },
  { id: "off_platform", re: "\\bswisha?\\b", gate: "local-rail" },
  { id: "off_platform", re: "\\bvipps\\b", gate: "local-rail" },

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
  { id: "pay_on_collection", re: "when\\s+you\\s+pick(?:\\s+it)?\\s+up", gate: "none" },
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

function localPayNear(text, start, end, window) {
  const slice = text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
  // "Payment by Swish" and "betalning via Swish" name a method.
  // "pay 500" stays an ask; "pay by Swish" does not.
  const listing = slice.replace(
    /(?<![\p{L}\p{N}])(?:via|betaling|betalning|payment)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])pay(?![\p{L}\p{N}])(?!\s+\d)/giu,
    " "
  );
  return hasPayWord(listing);
}

function negatedBefore(text, start) {
  const before = text.slice(Math.max(0, start - 28), start);
  return /(?:no|not|don't|dont|never|without|ingen|uden|ikke|nej)\s+$/iu.test(before);
}

// Words that can sit between the phrase and "is not required" / "is a scam"
// without starting a new clause. "meeting is not necessary" does not qualify.
const TAIL_NEG = /^(?:(?:of|the|a|an|elsewhere|kr|dkk|eur|euro|usd|\d+)\s+)*(?:(?:is|are|was|were)\s+not\s+(?:required|necessary|needed|a\s+requirement)|(?:is|are|was|were)n['’]?t\s+(?:required|necessary|needed)|not\s+(?:required|necessary|needed)|is\s+a\s+scam)\b/iu;

function cueNegated(span) {
  return /(?:^|[^\p{L}\p{N}'’])(?:not|no|never|nothing|without|ikke|ingen|uden|nej|\p{L}+n['’]t)\s+(?:up[ \t]*front|in[ \t]+advance)\s*$/iu.test(span);
}

// "shouldn't pay", "won't have to pay", "cannot pay". "can pay" does not match.
const MODAL_NEG = "(?:(?:should|would|could|must|shall|can)(?:\\s+not|n['’]?t)|will\\s+not|won['’]?t|cannot|shan['’]?t)";
const MODAL_NEG_BEFORE = new RegExp(`\\b${MODAL_NEG}\\s+(?:(?:have|need)\\s+to\\s+)?$`, "iu");

// "Pay in advance? No, cash when we meet is fine." The question mark ends the
// ask, and the answer refuses it. "No problem" does not.
function refusedAfterQuestion(rest) {
  return /^\s*\?\s*(?:no|nope|nah)\b(?!\s+(?:problem|worries|issues?|rush)\b)/iu.test(rest);
}

// Negation has to target this phrase ("no upfront", "don't pay", "don't need
// payment", "shouldn't pay", "is not required" right after it, or a "No"
// answer). A later clause does not ("no meetup", "meeting is not necessary").
function phraseNegated(text, start, end) {
  if (negatedBefore(text, start)) return true;
  const before = text.slice(Math.max(0, start - 48), start);
  const boundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  const prefix = boundary === -1 ? before : before.slice(boundary + 1);
  if (/\b(?:no|ingen)\s+need\s+to\s+$/iu.test(prefix)) return true;
  if (/\b(?:do\s+not|don['’]?t|dont|does\s+not|doesn['’]?t)\s+(?:have\s+to|need(?:\s+to)?)\s+$/iu.test(prefix)) return true;
  if (/\bnot\s+(?:required|necessary|needed)\s+to\s+$/iu.test(prefix)) return true;
  if (MODAL_NEG_BEFORE.test(prefix)) return true;
  if (cueNegated(text.slice(start, end))) return true;
  const rest = text.slice(end);
  if (refusedAfterQuestion(rest)) return true;
  const cut = rest.search(/[.!?\n]/);
  const sentence = cut === -1 ? rest : rest.slice(0, cut);
  const tail = sentence.split(/[^\p{L}\p{N}'’]+/u).filter(Boolean).slice(0, 8).join(" ");
  if (!tail) return false;
  return TAIL_NEG.test(tail);
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

// "send" and "transfer" count only when the gap names money ("500 kr", "$50",
// "money", "the deposit", "50%", "half", "the amount", "500"). The match starts
// at "send", so a later pay cue ("payment", "pay") has to count as that money
// or "send payment upfront" is swallowed. A refused cue ("no payment", "don't
// need payment", "do not pay") does not count, and neither does purchase
// history. "send the address in advance" does not. A bare number counts only
// when no noun follows it: it sits right before upfront / in advance, or before
// now / today / the end of the sentence. "2 photos" and "10 more photos" do not.
// "payment details" and "payment link" name a thing, not the money. "paid ...
// ago", "paid ... last month", "paid ... in 2022", "paid ... when I bought",
// and "I paid for the service" are history, not an ask.
const MONEY_WORD = /(?<![\p{L}\p{N}])(?:money|cash|funds|fees?|deposits?|depositum|kroner|dollars?|euros?|amounts?|half)(?![\p{L}\p{N}])/iu;
const BARE_AMOUNT = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?:\s*%)?(?![\p{L}\p{N}])/iu;
const PAST_PAY = /(?<![\p{L}\p{N}])(?:ago|last[ \t]+(?:night|week|month|year)|bought|purchased|in[ \t]+(?:19|20)\d{2})(?![\p{L}\p{N}])/iu;
// Words that can follow "payment" while it still means the money. Anything else
// ("details", "link", "info") is the thing being sent.
const PAYMENT_MONEY_NEXT = String.raw`up[ \t]*front|in[ \t]+advance|now|today|tonight|to|for|of|via|by|on|with|through|into|from|before|after|over|up|in|please|asap|immediately|directly|just|only|and|or|half|money|cash|funds|fees?|deposits?|amounts?|kr|kroner|dollars?|euros?|me|you`;
const PAYMENT_THING = new RegExp(
  String.raw`^payment[:,;]?[ \t]+(?!(?:${PAYMENT_MONEY_NEXT})(?![\p{L}\p{N}]))[\p{L}]`,
  "iu"
);

function upfrontCue(span) {
  const match = /^(paid|paying|payment|pay|send|transfer)(?![\p{L}\p{N}])/iu.exec(span)
    || /(?<![\p{L}\p{N}])(paid|paying|payment|pay|send|transfer)(?![\p{L}\p{N}])\s*$/iu.exec(span);
  return match ? match[1].toLowerCase() : "";
}

function sentenceAt(text, start) {
  const before = text.slice(0, start);
  const boundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  const head = boundary === -1 ? before : before.slice(boundary + 1);
  const rest = text.slice(start);
  const cut = rest.search(/[.!?\n]/);
  return head + (cut === -1 ? rest : rest.slice(0, cut));
}

function bareAmountCounts(span) {
  const re = new RegExp(BARE_AMOUNT.source, "giu");
  for (const match of span.matchAll(re)) {
    const after = span.slice((match.index ?? 0) + match[0].length);
    if (/^[ \t]*[,:]?[ \t]*(?:(?:up[ \t]*front|in[ \t]+advance|now|today)\b|[.!?]?$)/iu.test(after)) return true;
  }
  return false;
}

function paymentNamesThing(text, wordStart) {
  return PAYMENT_THING.test(text.slice(wordStart));
}

function paidHistory(text, start) {
  const sentence = sentenceAt(text, start);
  if (PAST_PAY.test(sentence)) return true;
  // "I paid for the service upfront." A past purchase with no amount.
  if (/^\s*I\s+paid\s+for\b/iu.test(sentence) && !amountSpans(sentence).length && !bareAmountCounts(sentence)) return true;
  return false;
}

// The leftmost cue swallows a later one. "payment" and "pay" are pay cues,
// so they are the money in the gap when this window is not refused.
function gapPayCue(text, start, end) {
  const span = text.slice(start, end);
  const re = /(?<![\p{L}\p{N}])(paid|paying|payment|pay)(?![\p{L}\p{N}])/giu;
  for (const match of span.matchAll(re)) {
    if ((match.index ?? 0) === 0) continue;
    const cueStart = start + (match.index ?? 0);
    const word = match[1].toLowerCase();
    if (phraseNegated(text, cueStart, end)) continue;
    if (word === "paid" && paidHistory(text, cueStart)) continue;
    if (word === "payment" && paymentNamesThing(text, cueStart)) continue;
    return true;
  }
  return false;
}

function spanHasMoney(text, start, end) {
  const span = text.slice(start, end);
  if (MONEY_WORD.test(span) || bareAmountCounts(span)) return true;
  if (amountSpans(text).some((amount) => amount.start < end && amount.end > start)) return true;
  return gapPayCue(text, start, end);
}

function upfrontWindowOk(text, start, end) {
  if (phraseNegated(text, start, end)) return false;
  const span = text.slice(start, end);
  const cue = upfrontCue(span);
  if (cue === "payment" && paymentNamesThing(text, start)) return false;
  if ((cue === "send" || cue === "transfer") && !spanHasMoney(text, start, end)) return false;
  if (cue === "paid" && paidHistory(text, start)) return false;
  return true;
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

// "Pay me on Telegram" is a pay ask. Words in between count only when the amount
// is what is being paid or sent, not a price later in a contact line.
function paymentViaChat(text, start, end) {
  if (negatedBefore(text, start)) return false;
  const span = text.slice(start, end);
  const prepAt = span.search(/\b(?:on|via|på)\s+(?:whatsapp|telegram)\s*$/iu);
  if (prepAt < 0) return false;
  const gap = span.slice(0, prepAt);
  if (/^(?:pay|send|betal)\s+(?:me\s+)?$/iu.test(gap)) return true;
  const gapEnd = start + prepAt;
  return amountSpans(text).some((amount) => amount.start >= start && amount.end <= gapEnd);
}

function railNegated(text, start) {
  const before = text.slice(Math.max(0, start - 48), start);
  // A list stays under the negation ("don't take Venmo or Zelle").
  // "so"/"but" start a new ask, and "not" inside "cannot" does not count.
  return /(?<![\p{L}\p{N}])(?:won't|wont|don't|dont|do\s+not|no|not|never|without|ikke|ingen|uden|nej|aldrig)(?![\p{L}\p{N}])(?:\s+(?!(?:so|but)(?![\p{L}\p{N}]))[\p{L}\p{N}]+){0,6}\s+$/iu.test(before);
}

function pickupRefused(before, after) {
  // "Pickup isn't possible" refuses. Those words sit after the pickup word.
  if (/^\s*(?:isn't|isn\u2019t|isnt|is\s+not)\s+possible\b/iu.test(after || "")) return true;
  const match = before.match(/(?<![\p{L}\p{N}])(?:won't|wont|don't|dont|do\s+not|can't|cant|cannot|no|not|never|without|ikke|ingen|uden|nej|aldrig)(?![\p{L}\p{N}])(?:\s+\w+){0,3}\s+$/iu);
  if (!match) return false;
  // "no problem at pickup" offers the handover.
  return !/(?<![\p{L}\p{N}])no(?:t)?(?![\p{L}\p{N}])(?:\s+a)?\s+problems?\b/iu.test(match[0]);
}

// Payment at the handover ("when I pick it up", "at pickup", "when we meet").
// "collect the car" and "pick it up Saturday" name a later handover.
const TIED_HANDOVER = /(?:at|on)\s+pick\s*up|(?:at|on)\s+collection|when\s+you\s+collect|when\s+(?:i|you|we)\s+pick(?:\s+it)?\s*up|when\s+we\s+meet|when\s+you\s+come\s+to\s+see(?:\s+it)?|on\s+delivery|ved\s+levering|ved\s+afhentning|når\s+du\s+henter|när\s+du\s+hämtar|vid\s+upphämtning|när\s+vi\s+ses/iu;

function handoverPay(text) {
  const source = String(text ?? "");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${TIED_HANDOVER.source})(?![\\p{L}\\p{N}])`, "giu");
  for (const match of source.matchAll(re)) {
    const at = match.index ?? 0;
    const before = source.slice(Math.max(0, at - 48), at);
    const after = source.slice(at + match[0].length, at + match[0].length + 40);
    if (!pickupRefused(before, after)) return true;
  }
  return false;
}

// Clause breaks keep "available now" away from "pay with Zelle". "and"/"but"/"so"/"then" start one too.
const CLAUSE_BREAK = /[.!?;\n]|(?<!\d),(?!\d)|\s(?:and|but|so|then)\s/giu;
const SENTENCE_BREAK = /[.!?\n]/gu;
const TIMING_WORD = /(?<![\p{L}\p{N}])(?:now|today|first|reserve|hold|deposits?)(?![\p{L}\p{N}])/giu;
const RAIL_WORD = /(?<![\p{L}\p{N}])(?:western\s+union|moneygram|venmo|zelle|cash\s*app|swisha?|vipps|\$[a-z][a-z0-9_]{1,19})(?![\p{L}\p{N}])/iu;

function sliceAround(text, at, length, breaks) {
  const re = new RegExp(breaks.source, breaks.flags);
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(re)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (to <= at) start = to;
    else if (from >= at + length) {
      end = from;
      break;
    }
  }
  return { start, end, text: text.slice(start, end) };
}

function paysBeforeHandover(text) {
  const source = String(text ?? "");
  // "home today" and "available now" come after the handover and time the visit.
  // Count a timing word only in the same clause as the pay or rail word, and
  // only when this sentence has not already named the handover.
  const handoverRe = new RegExp(`(?<![\\p{L}\\p{N}])(?:${TIED_HANDOVER.source})(?![\\p{L}\\p{N}])`, "giu");
  const handovers = [...source.matchAll(handoverRe)].map((match) => match.index ?? 0);
  TIMING_WORD.lastIndex = 0;
  for (const match of source.matchAll(TIMING_WORD)) {
    const at = match.index ?? 0;
    const length = match[0].length;
    if (negatedBefore(source, at)) continue;
    const clause = sliceAround(source, at, length, CLAUSE_BREAK);
    if (!hasPayWord(clause.text) && !RAIL_WORD.test(clause.text)) continue;
    const sentence = sliceAround(source, at, length, SENTENCE_BREAK);
    if (handovers.some((start) => start >= sentence.start && start < at)) continue;
    return true;
  }
  return false;
}

function handoverQuietsRail(text) {
  if (!handoverPay(text)) return false;
  if (payFirstLanguage(text) || paysBeforeHandover(text)) return false;
  return true;
}

function payFirstLanguage(text) {
  const source = String(text ?? "");
  // "no payment before we meet" cancels the ask. "and I ship/post" counts like "then I ship".
  // "så skickar jag" is the Swedish ship line.
  const re = /pay(?:ment)?\s+first|betal\s+først|pay(?:ment)?\s+before|(?:swisha?|vipps)\s+first|first,?\s+then\s+i\s+(?:ship|send|post)|then\s+i\s+(?:ship|send|post)|and\s+i(?:['\u2019]ll|\s+will)?\s+(?:ship|post)(?![\p{L}\p{N}])|først,?\s+så\s+send|så\s+sender\s+jeg|så\s+skickar\s+jag|innan\s+jag\s+skickar/giu;
  for (const match of source.matchAll(re)) {
    if (!negatedBefore(source, match.index ?? 0)) return true;
  }
  return false;
}

function allow(rule, text, start, end) {
  if (rule.gate === "upfront-window") return upfrontWindowOk(text, start, end);
  if (rule.spanNegation && phraseNegated(text, start, end)) return false;
  if (rule.gate === "none" || rule.gate === "deposit-specific") return !negatedBefore(text, start);
  if (rule.gate === "chat-pay") return paymentViaChat(text, start, end);
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
  if (rule.gate === "named-rail" || rule.gate === "cashtag") {
    if (railNegated(text, start)) return false;
    if (handoverQuietsRail(text)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
  }
  if (rule.gate === "local-rail") {
    if (railNegated(text, start)) return false;
    const pay = localPayNear(text, start, end, 80);
    const money = amountNear(text, start, end, 80);
    const scam = payFirstLanguage(text);
    if (handoverQuietsRail(text)) return false;
    if (pay && money) return true;
    return scam && money;
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
