// Classic content script and a Node ESM side-effect module. No import/export.
// Load order in the extension: brand.js, tidy.js, atoms.js, extract.js, pay-risk.js.
// Patterns are case-insensitive and Unicode-aware. A hit is a concrete span.

const RULES_VERSION = 3;

function wordBound(pattern, flags = "giu") {
  const tidy = globalThis.pbTidy;
  if (tidy && typeof tidy.wordBound === "function") return tidy.wordBound(pattern, flags);
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, flags);
}

const PAY_WORD = wordBound("send|pay|paid|payment|paying|via|paypal|transfer|transferred|betal|betale|betaling|overfør|overfører|overfoer", "iu");

const ATOMS = [
  { id: "friends_family", role: "act", strength: "strong", receipt: "Friends & Family" },
  { id: "upfront_deposit", role: "act", strength: "strong", receipt: "Upfront deposit" },
  { id: "off_platform", role: "act", strength: "strong", receipt: "Off-platform payment" },
  { id: "pay_before_see", role: "act", strength: "strong", receipt: "Pay before seeing the item" },
  { id: "urgency_pressure", role: "act", strength: "weak", receipt: "Pressure to hurry" },
  { id: "ship_before_meet", role: "act", strength: "weak", receipt: "Ships before you meet" },
  // v3: account-takeover and phishing asks. "standalone" atoms are risky on their own,
  // without a pay word or an amount in the same message.
  { id: "credential_request", role: "act", strength: "strong", standalone: true, receipt: "Asks for card details, a code or a password" },
  { id: "remote_access", role: "act", strength: "strong", standalone: true, receipt: "Asks you to install remote-access software" },
  { id: "phishing_link", role: "act", strength: "strong", standalone: true, receipt: "Suspicious link to log in or pay" },
  { id: "fee_via_link", role: "act", strength: "strong", standalone: true, receipt: "Fee to pay before you get something" },
  { id: "impersonation", role: "act", strength: "weak", receipt: "Claims to be a bank, authority or platform" },
  { id: "account_threat", role: "act", strength: "weak", receipt: "Threat to close or lock your account" },
  // v3: the overpay-and-refund trick (the "accidental" overpayment, then refund the difference).
  { id: "overpayment_refund", role: "act", strength: "strong", receipt: "Overpay-and-refund trick" },
  { id: "pay_on_collection", role: "veto", strength: "veto", receipt: "Pay on collection or checkout" },
  { id: "goods_and_services_agreed", role: "veto", strength: "veto", receipt: "Goods & Services agreed" },
  // Not a rule: the chip shown when only the AI check flagged the chat.
  { id: "prize_bait", role: "ai", strength: "none", receipt: "Prize claim or premium-rate number" },
  { id: "free_bait", role: "ai", strength: "none", receipt: "Free gift behind a link" },
  { id: "ai_other", role: "ai", strength: "none", receipt: "Flagged by the AI check" }
];

const META = Object.fromEntries(ATOMS.map((atom) => [atom.id, atom]));

const RULES = [
  { id: "friends_family", re: "friends\\s+(?:and|&)\\s+family", gate: "ff-phrase" },
  { id: "friends_family", re: "venner\\s+(?:og|&)\\s+familie", gate: "ff-phrase" },
  { id: "friends_family", re: "F&F", gate: "none" },
  { id: "friends_family", re: "FnF", gate: "none" },
  { id: "friends_family", re: "send\\s+as\\s+gift", gate: "none" },
  { id: "friends_family", re: "personal\\s+payment", gate: "none" },

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
  // v2: IBANs are usually written in groups of four ("DE89 3704 0044 0532 0130 00").
  { id: "off_platform", re: "[A-Z]{2}\\d{2}(?:[ ][A-Z0-9]{4}){3,7}(?:[ ][A-Z0-9]{1,3})?", gate: "iban", flags: "gu" },
  { id: "off_platform", re: "(?:safe|secure|holding|new)\\s+(?:bank\\s+)?account", gate: "iban" },
  { id: "off_platform", re: "bank\\s+transfers?", gate: "negation" },
  { id: "off_platform", re: "wire\\s+transfers?", gate: "negation" },
  { id: "off_platform", re: "bankoverførsel", gate: "negation" },
  { id: "off_platform", re: "reg\\.?\\s*nr", gate: "negation" },
  { id: "off_platform", re: "registreringsnummer", gate: "negation" },
  { id: "off_platform", re: "konto\\s*nr\\.?", gate: "negation" },
  { id: "off_platform", re: "kontonummer", gate: "negation" },
  { id: "off_platform", re: "kontonr", gate: "negation" },
  { id: "off_platform", re: "account\\s+numbers?", gate: "acct" },
  { id: "off_platform", re: "sort\\s+codes?", gate: "acct" },
  { id: "off_platform", re: "revolut", gate: "negation" },
  { id: "off_platform", re: "(?:transferwise|wise\\.com|(?:via|on|with|til)\\s+wise)", gate: "negation" },
  { id: "off_platform", re: "bitcoin|bitcoins|\\bbtc\\b|ethereum|\\busdt\\b|crypto(?:currency)?", gate: "negation" },
  { id: "off_platform", re: "gift\\s*cards?|gavekort", gate: "giftcard" },
  // v2 (tuned on the eval/real dev split): irreversible P2P / cash rails and store cards.
  { id: "off_platform", re: "(?:steam|google\\s*play|itunes|apple|amazon|ebay)\\s+(?:gift\\s+)?cards?", gate: "giftcard" },
  { id: "off_platform", re: "zelle|cash\\s*app|venmo", gate: "negation" },
  { id: "off_platform", re: "western\\s+union|money\\s*gram|money\\s+orders?", gate: "negation" },
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

  // v3: card details, one-time codes, passwords and ID numbers (gate "cred": a request verb
  // in the same sentence, not "never share this code").
  { id: "credential_request", re: "(?:card\\s+(?:number|details|info(?:rmation)?|no\\.?)|(?:credit|debit)\\s+card(?:\\s+(?:number|details|info(?:rmation)?))?|cvv2?|cvc2?|security\\s+code\\s+on\\s+the\\s+back|expiry\\s+date|expiration\\s+date|kortnummer|kortoplysninger|kontrolcifre)", gate: "cred" },
  { id: "credential_request", re: "(?:one[-\\s]?time\\s+(?:pass(?:word|code)|code|pin)|otp|verification\\s+code|security\\s+code|confirmation\\s+code|login\\s+code|sms\\s+code|text\\s+code|\\d[-\\s]?digit\\s+code|(?:the\\s+)?code\\s+(?:i|we|you)(?:\\s+just)?\\s+(?:sent|got|received)|engangskode|sikkerhedskode|kode(?:n)?)", gate: "cred" },
  { id: "credential_request", re: "(?:mit\\s*id|nem\\s*id|bank\\s*id)(?:[-\\s]?(?:kode(?:n)?|code|app|login|nøgleviser))?", gate: "cred-id" },
  { id: "credential_request", re: "(?:pass(?:word|code)(?!\\s+(?:manager|management|reset))|pin[-\\s]?(?:code|number|kode)|(?:your|the|card|bank)\\s+pin|login\\s+(?:details|credentials|info(?:rmation)?)|log-?in\\s+details|username\\s+and\\s+password|(?:your|login|log-?in|account|bank(?:ing)?)\\s+credentials|adgangskode)", gate: "cred" },
  { id: "credential_request", re: "(?:social\\s+security\\s+(?:number|no\\.?)|ssn|cpr(?:[-\\s]?(?:nummer|number|nr\\.?))?|personnummer)", gate: "cred" },

  { id: "credential_request", re: "(?:bank\\s+)?account\\s+(?:number|details|info(?:rmation)?)(?:\\s+and\\s+(?:the\\s+)?(?:routing|sort)\\s+(?:number|code))?|routing\\s+number|bank(?:ing)?\\s+(?:details|info(?:rmation)?|login)", gate: "cred" },
  { id: "credential_request", re: "(?:send|give|tell|provide|read|share|forward|text)\\s+(?!you\\b)(?:me\\s+|us\\s+)?(?:\\w+\\s+){0,4}?(?:the\\s+|your\\s+|that\\s+|this\\s+)?(?:code|codes)", gate: "cred-inline" },

  // v3: remote-access apps. Brand names fire on their own; the generic phrase needs an install verb.
  { id: "remote_access", re: "any\\s*desk|team\\s*viewer|quick\\s*support|quick\\s*assist|rust\\s*desk|ultra\\s*viewer|ammyy(?:\\s+admin)?|logmein|splashtop|supremo|screenconnect", gate: "negation" },
  { id: "remote_access", re: "remote[-\\s](?:access|desktop|control|support)(?:\\s+(?:tool|app|software|program))?|screen[-\\s]?shar(?:e|ing)", gate: "remote" },
  { id: "remote_access", re: "remote\\s+in(?:\\s*to)?\\s+(?:your|the)\\s+(?:computer|pc|laptop|device|phone|machine)", gate: "negation" },

  // v3: links that ask you to log in, verify, claim or pay (gate "link" checks the host and nearby words).
  { id: "phishing_link", re: "(?:https?://|www\\.)[^\\s<>()\\[\\]\"']+|[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:xyz|top|click|live|icu|ru|tk|ml|ga|cf|gq|zip|mov|cam|rest|monster|info|online|site|shop|support|link|gift|ly|gg)(?:/[^\\s<>()\\[\\]\"']*)?", gate: "link", flags: "giu" },
  // Bare domains on common TLDs count only when the host itself looks off (lookalike, brand in a
  // stranger's host, lure word in the host); the "link" gate checks that via suspiciousHost.
  { id: "phishing_link", re: "\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:com|net|org|dk|se|no|de|eu|io|co|app|me|biz|example)(?:/[^\\s<>()\\[\\]\"']*)?", gate: "link", flags: "giu" },
  { id: "phishing_link", re: "(?:click|tap|press|follow|use|open|klik)\\s+(?:on\\s+)?(?:here|this\\s+link|the\\s+link|the\\s+button\\s+below|below|linket|her)(?:\\s+(?:and|to|og|for\\s+at))?\\s+(?:\\w+\\s+){0,2}?(?:verify|confirm|log\\s*in|login|sign\\s*in|pay|claim|update|unlock|restore|receive|reactivate|validate|bekræfte|modtage|betale|logge\\s+ind)", gate: "negation" },
  { id: "phishing_link", re: "(?:receive|get|accept|modtag(?:e)?|få)\\s+(?:the\\s+|your\\s+)?(?:payment|money|pengene|betalingen|beløbet|funds)\\s+(?:via|through|by\\s+clicking|using|på|gennem|med)\\s+(?:this\\s+|the\\s+)?(?:link|linket)", gate: "negation" },
  { id: "phishing_link", re: "(?:confirm|verify)\\s+(?:your\\s+)?(?:ownership|identity|account|details)\\s+(?:via|through|using|at|on)\\s+(?:this|the)\\s+(?:link|site|page)", gate: "negation" },

  // v3: "pay the fee via this link" and fees to release a parcel, prize or refund.
  { id: "fee_via_link", re: "(?:customs|delivery|shipping|handling|processing|release|clearance|redelivery|activation|verification|unlock(?:ing)?|transfer|insurance|admin(?:istration)?|tax|toll|told|gebyr|fragt)\\s*(?:fee|charge|duty|payment|cost|gebyr|afgift)s?", gate: "fee" },
  { id: "fee_via_link", re: "(?:pay|cover|settle|betal)\\s+(?:a\\s+|the\\s+|this\\s+|small\\s+|a\\s+small\\s+)?(?:fee|charge|gebyr)", gate: "fee" },

  // v3: impersonation (weak alone; with a link, code or fee ask it becomes high).
  { id: "impersonation", re: "this\\s+is\\s+(?:the\\s+|your\\s+)?(?:bank|[a-z]+\\s+bank|fraud\\s+(?:department|team)|security\\s+(?:team|department)|discord\\s+(?:staff|team|support)|irs|hmrc|skat|politi(?:et)?|police|customs|tax\\s+(?:office|authority)|microsoft|apple|amazon|paypal|mitid|dba|postnord|gls|dao)", gate: "negation" },
  { id: "impersonation", re: "(?:your\\s+)?bank['’]?s?\\s+(?:security|fraud|operations)(?:\\s+(?:team|department|center|centre|alert))?", gate: "negation" },
  { id: "impersonation", re: "fraud\\s+(?:department|prevention|team|alert|unit)|security\\s+(?:team|department|operations\\s+cent(?:er|re))", gate: "negation" },
  { id: "impersonation", re: "(?:microsoft|windows|apple|amazon|paypal|discord|facebook|meta|mitid|nemid|dba|netflix|steam|postnord|gls|dhl|ups|fedex)\\s+(?:support|security|staff|team|help\\s*desk|customer\\s+(?:service|support)|kundeservice)", gate: "negation" },
  { id: "impersonation", re: "tech(?:nical)?\\s+support|social\\s+security\\s+administration|internal\\s+revenue\\s+service|skattestyrelsen", gate: "negation" },
  { id: "impersonation", re: "(?:calling|writing)\\s+(?:you\\s+)?from\\s+(?:the\\s+|your\\s+)?(?:bank|police|politi(?:et)?|irs|hmrc|skat|tax\\s+office|customs|microsoft|apple|amazon)", gate: "negation" },

  { id: "account_threat", re: "account\\s+(?:will\\s+be|has\\s+been|is|was|may\\s+be)\\s+(?:temporarily\\s+|permanently\\s+)?(?:closed|suspended|limited|locked|blocked|frozen|deactivated|compromised|disabled|terminated|restricted|compromise)", gate: "negation" },
  { id: "account_threat", re: "(?:computer|pc|laptop|device|phone|system)\\s+(?:has|have|is|was)\\s+(?:been\\s+)?(?:\\d+\\s+)?(?:a\\s+)?(?:virus(?:es)?|malware|infected|hacked|compromised)|virus(?:es)?\\s+(?:infection\\s+)?detected|files\\s+(?:are|will\\s+be)\\s+locked", gate: "negation" },
  { id: "account_threat", re: "(?:suspicious|unusual|unauthori[sz]ed)\\s+(?:activity|activities|login|log-?in|access|transactions?|sign-?in)", gate: "negation" },

  // v3: overpay-and-refund. Both an overpay cue and a refund-the-difference ask must be present.
  { id: "overpayment_refund", re: "refund[^\\n]{0,40}?(?:the\\s+)?(?:extra|difference|overpay(?:ment)?|rest|amount)", gate: "overpay" },
  { id: "overpayment_refund", re: "(?:send|transfer|pay|give)\\s+(?:me\\s+)?(?:back|the\\s+extra|the\\s+difference)[^\\n]{0,30}?(?:extra|difference|rest|overpay)", gate: "overpay" },
  { id: "overpayment_refund", re: "overpa(?:y|id|ying|yment)", gate: "overpay" },
  { id: "overpayment_refund", re: "(?:too\\s+much|instead\\s+of)[^\\n]{0,40}?(?:by\\s+mistake|mistake)", gate: "overpay" },
  { id: "overpayment_refund", re: "betalt[^\\n]{0,30}?for\\s+meget|overf\u00f8rt[^\\n]{0,30}?for\\s+meget", gate: "overpay" },

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

const REFUND_CUE = /(?:refund|send\s+(?:me\s+)?(?:back|the\s+extra|the\s+difference)|pay\s+(?:me\s+)?back|transfer\s+back|return\s+(?:the\s+|me\s+the\s+)?(?:extra|difference)|give\s+(?:me\s+)?back|tilbagebetale|refundere)/iu;
const OVERPAY_CUE = /(?:overpa(?:y|id|ying|yment)|too\s+much|instead\s+of|by\s+mistake|accidentally|for\s+meget|ved\s+en\s+fejl)/iu;

// The overpay-and-refund trick needs both halves: an overpay cue and a refund-the-difference ask.
function overpayAllowed(text, start, end) {
  if (negatedBefore(text, start)) return false;
  const window = text.slice(Math.max(0, start - 160), Math.min(text.length, end + 160));
  return REFUND_CUE.test(window) && OVERPAY_CUE.test(window);
}

// Tags name a specific trick behind a generic signal, so the card explains the real pattern.
// They never raise a level on their own; they only pick card wording once a card is due.
const GIFTCARD_PAY = /(?:pay|paid|payment|paying|buy|bought|purchase|send|sent|with|via|using|only\s+way|k\u00f8b|betal)[^.!?\n]{0,60}?(?:gift\s*cards?|gavekort|(?:steam|google\s*play|itunes|apple|amazon|ebay)\s+(?:gift\s+)?cards?)|(?:gift\s*cards?|gavekort)[^.!?\n]{0,60}?(?:pay|paid|payment|buy|send|only\s+way)/iu;

function riskTags(text) {
  const source = String(text ?? "");
  const tags = [];
  if (OVERPAY_CUE.test(source) && REFUND_CUE.test(source)) tags.push("overpayment_refund");
  if (GIFTCARD_PAY.test(source)) tags.push("gift_card");
  return tags;
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

// v3 helpers ---------------------------------------------------------------
const REQUEST_VERB = /(?:send|share|give|tell|provide|confirm|enter|type|read|reply|text|forward|need|verify|update|submit|fill\s+in|what(?:'s|’s|\s+is|\s+are)|can\s+i\s+(?:get|have)|requires?|required|sende|send\s+mig|giv|oplys|indtast|bekræft|skriv|tast)/iu;
const REQUEST_AFTER = /^\s*(?:please|pls|here|to\s+me|now|asap|so\s+(?:i|we)\s+can|for\s+(?:verification|the\s+refund|the\s+payment)|to\s+(?:confirm|verify|process|claim|receive|release)|tak|til\s+mig)/iu;
const SENTENCE_NEG = /(?:never|don't|don’t|do\s+not|dont|won't|won’t|will\s+not|wouldn't|would\s+never|doesn't|does\s+not|no\s+need\s+to|aldrig|ikke)\b/iu;
const OFFICIAL = /official\s+(?:\w+\s+)?(?:app|website|site|number)|the\s+number\s+on\s+the\s+back|ignore\s+this|didn't\s+request|did\s+not\s+request/iu;
const LOGIN_VERB = /(?:log\s*(?:ind|in|on)|login|sign\s*in|confirm|bekræft|godkend|approve|verify|identify|identificer)\s+(?:dig\s+|yourself\s+)?(?:med|with|via|using|in|i|på)\s+(?:your\s+|din\s+)?$/iu;
const REMOTE_VERB = /(?:download|install|open|use|run|give|grant|allow|let\s+(?:me|us)|access|connect|hent|installer|åbn)/iu;
const LURE = /(?:verify|verification|confirm|log\s*in|login|sign\s*in|claim|pay|unlock|update|free|click|enter|gift|nitro|account|password|prize|won|reward|bonus|airdrop|refund|customs|parcel|package|suspend|limited|bekræft|log\s+ind|betal|modtag|gratis)/iu;
const FEE_CONTEXT = /(?:https?:\/\/|www\.|\blink\b|linket|click|tap\s+(?:here|the)|klik|claim|prize|won|winner|release|unlock|customs|held|refund|gift\s*card|reward|inheritance|redeliver|toll|told)/iu;
const SHORTENERS = /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|sc\.link|ow\.ly|shorturl\.at|tiny\.cc|s\.id|t\.ly|bl\.ink|rebrand\.ly)$/iu;
const ODD_TLD = /\.(?:xyz|top|click|live|icu|ru|tk|ml|ga|cf|gq|zip|mov|cam|rest|monster|info|online|site|shop|support|link|gift)$/iu;
const BENIGN_SUB = /^(?:www|support|help|helpcenter|billing|account|accounts|my|app|mail|portal|customer|service|status|docs)$/iu;
const HOST_LURE = /(?:secure|verify|verif|login|signin|account|update|confirm|wallet|unlock|claim|bonus|gift|reward|prize|nitro|refund|customs|deliver|parcel|support|check|auth|payment|airdrop|free)/iu;
const BRANDS = ["paypal", "mitid", "nemid", "dba", "discord", "steam", "amazon", "apple", "microsoft", "netflix", "postnord", "gls", "dhl", "facebook", "mobilepay"];
const OFFICIAL_DOMAINS = /(?:^|\.)(?:paypal\.com|paypal\.me|mitid\.dk|nemid\.nu|dba\.dk|discord\.com|discord\.gg|discordapp\.com|steampowered\.com|steamcommunity\.com|amazon\.[a-z.]+|apple\.com|microsoft\.com|netflix\.com|postnord\.[a-z]+|gls-group\.[a-z]+|gls\.dk|dhl\.[a-z]+|facebook\.com|mobilepay\.dk)$/iu;
const LOOKALIKE = /paypa1|payp4l|pay-pal|disc0rd|dlscord|discorcl|d1scord|steamcomunity|steamcommunlty|stearn|amaz0n|micr0soft|faceb00k|netfl1x|m1tid|rnitid/iu;

function sentenceAround(text, start, end) {
  let a = start;
  while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
  let b = end;
  while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
  return { from: a, to: b, before: text.slice(a, start), after: text.slice(end, b), whole: text.slice(a, b) };
}

function credAllowed(text, start, end, extraBefore) {
  const s = sentenceAround(text, start, end);
  if (SENTENCE_NEG.test(s.before) || OFFICIAL.test(s.whole)) return false;
  const before = s.before.slice(-90);
  if (REQUEST_VERB.test(before)) return true;
  if (extraBefore && extraBefore.test(before)) return true;
  return REQUEST_AFTER.test(s.after);
}

function hostOf(url) {
  const raw = url.replace(/^(?:https?:\/\/)/iu, "").replace(/^www\./iu, "");
  return raw.split(/[/?#:]/)[0].toLowerCase().replace(/\.+$/, "");
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// "dischrd", "paypa1", "stearn": one or two edits away from a brand name.
function lookalikeLabel(label) {
  return BRANDS.some((brand) => brand.length >= 5 && label !== brand && Math.abs(label.length - brand.length) <= 2 && editDistance(label, brand) <= (brand.length >= 7 ? 2 : 1));
}

function suspiciousHost(host) {
  if (!host || !host.includes(".")) return false;
  if (SHORTENERS.test(host)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes("xn--")) return true;
  if (LOOKALIKE.test(host)) return true;
  if (host.split(".").some((label) => lookalikeLabel(label.replace(/^www$/, "")))) return true;
  if (OFFICIAL_DOMAINS.test(host)) return false;
  if (ODD_TLD.test(host)) return true;
  const labels = host.split(".");
  const name = labels.slice(0, -1).join(".");
  if (BRANDS.some((brand) => name.includes(brand))) return true;
  // A lure word counts only in the site's own name ("secure-pay-check.com"), not in a
  // subdomain of an ordinary site ("support.example.com").
  // A plain service subdomain of an ordinary site ("support.example.com", "help.", "billing.")
  // is not a lure; compound labels ("prize-verify.", "yourbank-secure.") still are.
  const parts = labels.slice(0, -1).filter((label, i, all) => i === all.length - 1 || !BENIGN_SUB.test(label));
  return HOST_LURE.test(parts.join("."));
}

function linkAllowed(text, start, end) {
  const url = text.slice(start, end);
  if (!suspiciousHost(hostOf(url))) return false;
  const near = text.slice(Math.max(0, start - 140), Math.min(text.length, end + 140));
  return LURE.test(near);
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
  if (rule.gate === "acct") {
    // "Your account number: XXXX" on a bill or receipt is the reader's own account, not a payee.
    if (/your\s+(?:\w+\s+)?$/iu.test(text.slice(Math.max(0, start - 20), start))) return false;
    if (negatedBefore(text, start)) return false;
    return payWordNear(text, start, end, 80);
  }
  if (rule.gate === "overpay") return overpayAllowed(text, start, end);
  if (rule.gate === "giftcard") {
    if (negatedBefore(text, start)) return false;
    // A gift card offered as a prize or reward is not a request to pay with one.
    const before = text.slice(Math.max(0, start - 48), start);
    if (/(?:receive|win|won|winner|selected|reward(?:ed)?|free|claim|earn|get|give\s+you|send\s+you)\b[^.!?\n]{0,36}$/iu.test(before)) return false;
    return true;
  }
  if (rule.gate === "cred") return credAllowed(text, start, end, null);
  if (rule.gate === "cred-inline") {
    const sentence = sentenceAround(text, start, end);
    return !SENTENCE_NEG.test(sentence.before) && !OFFICIAL.test(sentence.whole) && !/(?:promo|discount|coupon|rabat|dress|zip|post(?:al)?|qr|source)\s+codes?$/iu.test(text.slice(start, end));
  }
  if (rule.gate === "cred-id") return credAllowed(text, start, end, LOGIN_VERB);
  if (rule.gate === "remote") {
    if (negatedBefore(text, start)) return false;
    const s = sentenceAround(text, start, end);
    if (SENTENCE_NEG.test(s.before)) return false;
    return REMOTE_VERB.test(s.whole);
  }
  if (rule.gate === "link") return linkAllowed(text, start, end);
  if (rule.gate === "fee") {
    if (negatedBefore(text, start)) return false;
    const near = text.slice(Math.max(0, start - 150), Math.min(text.length, end + 150));
    return FEE_CONTEXT.test(near) && (hasPayWord(near) || amountNear(text, start, end, 120) || /(?:https?:\/\/|www\.|click|klik)/iu.test(near));
  }
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
  suspiciousHost,
  goodsHit,
  riskTags
};
