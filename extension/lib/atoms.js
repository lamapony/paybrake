// Classic content script and a Node ESM side-effect module. No import/export.
// Load order in the extension: brand.js, tidy.js, atoms.js, extract.js, pay-risk.js.
// Patterns are case-insensitive and Unicode-aware. A hit is a concrete span.

const RULES_VERSION = 4;

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

// Words between the pay cue and upfront / in advance. A period ends the
// sentence, except inside a dotted amount (1.500, $12.50) or abbreviation (e.g.).
const GAP_TOKEN = "(?:\\$?\\d+(?:[.,]\\d+)+|(?:[A-Za-z]\\.){2,}|[^\\s.!?\\n]+)";
const SPAN_GAP = `[ \\t]+(?:${GAP_TOKEN}[ \\t]+){0,8}`;
const UP_FRONT = "up[ \\t]*front";
const PAY_CUE = "(?:paid|pay(?:ing|ment)?|send|transfer)[:,;]?";
// Reversed "upfront payment" only. A wide gap treats "to be upfront" and
// "the light up front" as a deposit when "pay" shows up later in the line.
const REVERSE_GAP = "[ \\t]+";
// Words between wire/transfer and "to <bank>". . , ; ! ? end the clause.
// An amount may still contain a dot or comma (1.500, 1,800, $12.50).
const WIRE_BANK_GAP = "(?:\\$?\\d+(?:[.,]\\d+)+|[^\\s.,;!?]+)";

const RULES = [
  { id: "friends_family", re: "friends\\s+(?:and|&)\\s+family", gate: "ff-phrase" },
  { id: "friends_family", re: "venner\\s+(?:og|&)\\s+familie", gate: "ff-phrase" },
  { id: "friends_family", re: "F&F", gate: "ff-token" },
  { id: "friends_family", re: "FnF", gate: "none" },
  { id: "friends_family", re: "family\\s+(?:and|&)\\s+friends", gate: "ff-phrase" },
  { id: "friends_family", re: "familie\\s+(?:og|&)\\s+venner", gate: "ff-phrase" },
  { id: "friends_family", re: "friends\\s*/\\s*family", gate: "ff-phrase" },
  { id: "friends_family", re: "friends\\s+(?:and|&)\\s+family\\s+only", gate: "ff-dictated" },
  { id: "friends_family", re: "family\\s+(?:and|&)\\s+friends\\s+only", gate: "ff-dictated" },
  { id: "friends_family", re: "friends\\s+(?:and|&)\\s+family\\s+is\\s+fine", gate: "ff-pivot" },
  { id: "friends_family", re: "family\\s+(?:and|&)\\s+friends\\s+is\\s+fine", gate: "ff-pivot" },
  { id: "friends_family", re: "F\\s+&\\s+F", gate: "none" },
  // Whole words only (sender/sende are listed; resend and gifted are not).
  // The gap cannot cross . ! ? or a newline, and it cannot swallow as/som.
  // "gift card" / "gavekort" stay off-platform.
  { id: "friends_family", re: `send(?:er|e)?(?![\\p{L}\\p{N}])(?:[ \\t]+(?!as(?![\\p{L}\\p{N}]))(?:${GAP_TOKEN})){0,6}[ \\t]+as[ \\t]+(?:a[ \\t]+)?gift(?![\\p{L}\\p{N}])(?![ \\t]*cards?(?![\\p{L}\\p{N}]))`, gate: "gift-ask" },
  { id: "friends_family", re: `(?:send(?:er|e)?|betal(?:e|ing)?)(?![\\p{L}\\p{N}])(?:[ \\t]+(?!som(?![\\p{L}\\p{N}]))(?:${GAP_TOKEN})){0,6}[ \\t]+som[ \\t]+gave(?![\\p{L}\\p{N}])(?![ \\t]*kort(?![\\p{L}\\p{N}]))`, gate: "gift-ask" },
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
  // v2: IBANs are usually written in groups of four ("DE89 3704 0044 0532 0130 00").
  { id: "off_platform", re: "[A-Z]{2}\\d{2}(?:[ ][A-Z0-9]{4}){3,7}(?:[ ][A-Z0-9]{1,3})?", gate: "iban", flags: "gu" },
  { id: "off_platform", re: "(?:safe|secure|holding|new)\\s+(?:bank\\s+)?account", gate: "iban" },
  { id: "off_platform", re: "bank\\s+transfers?", gate: "negation" },
  { id: "off_platform", re: "wire\\s+transfers?", gate: "negation" },
  // "wire/transfer … to my bank" or "to my bank account". Still open:
  // "to our bank", "to the bank account", "to your account", and
  // Danish/Swedish "overfør" / "överför … til min konto".
  { id: "off_platform", re: `(?<![\\p{L}\\p{N}])(?:wire|transfer)(?:[ \\t]+(?!to\\b)${WIRE_BANK_GAP}){0,6}[ \\t]+to[ \\t]+(?:my[ \\t]+)?bank(?:[ \\t]+account)?`, gate: "wire-bank", flags: "giu" },
  { id: "off_platform", re: "bankoverførsel", gate: "negation" },
  { id: "off_platform", re: "reg\\.?\\s*nr", gate: "negation" },
  { id: "off_platform", re: "registreringsnummer", gate: "negation" },
  { id: "off_platform", re: "konto\\s*nr\\.?", gate: "negation" },
  { id: "off_platform", re: "kontonummer", gate: "negation" },
  { id: "off_platform", re: "kontonr", gate: "negation" },
  { id: "off_platform", re: "account\\s+numbers?", gate: "acct" },
  { id: "off_platform", re: "sort\\s+codes?", gate: "acct" },
  { id: "off_platform", re: "revolut", gate: "negation" },
  { id: "off_platform", re: "(?:transferwise|wise\\.com|\\b(?:via|on|with|til|through|på)\\s+wise\\b|\\bwise\\s+transfer\\b)", gate: "negation" },
  // "using Wise" and "by Wise". The Wise line above is unchanged.
  { id: "off_platform", re: "(?:using|by)\\s+wise", gate: "negation" },
  { id: "off_platform", re: "bitcoin|bitcoins|\\bbtc\\b|ethereum|\\busdt\\b|crypto(?:currency)?", gate: "negation" },
  { id: "off_platform", re: "gift\\s*cards?|gavekort", gate: "giftcard" },
  // Store cards ("Steam card", "Google Play cards") are the same ask as "gift card".
  { id: "off_platform", re: "(?:steam|google\\s*play|itunes|apple|amazon|ebay)\\s+(?:gift\\s+)?cards?", gate: "giftcard" },
  // PlayStation, Xbox, Nintendo, and Netflix cards. The store-card line above stays.
  // A console or the show has no "card", so it does not match.
  { id: "off_platform", re: "(?:playstation|xbox|nintendo|netflix)\\s+(?:gift\\s+)?cards?", gate: "pay-or-amount" },
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
  // Skrill and Interac. A bare name ("Skrill is a town") is not an ask.
  { id: "off_platform", re: "skrill", gate: "pay-or-amount" },
  { id: "off_platform", re: "interac", gate: "pay-or-amount" },
  // "PayPal me" already contains the pay word paypal, so only a parsed amount counts.
  { id: "off_platform", re: "paypal\\s+me", gate: "amount-near" },

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
  { id: "credential_request", re: "(?:one[-\\s]?time\\s+(?:pass(?:word|code)|code|pin)|otp|verification\\s+code|security\\s+code|confirmation\\s+code|login\\s+code|sms\\s+code|text\\s+code|\\d[-\\s]?digit\\s+code|(?:the\\s+)?code\\s+(?:i|we|you)(?:\\s+just)?\\s+(?:sent|got|received)|engangskode(?:n)?|sikkerhedskode|kode(?:n)?)", gate: "cred" },
  { id: "credential_request", re: "(?:mit\\s*id|nem\\s*id|bank\\s*id)(?:[-\\s]?(?:kode(?:n)?|code|app|login|nøgleviser))?", gate: "cred-id" },
  { id: "credential_request", re: "(?:pass(?:word|code)(?!\\s+(?:manager|management|reset))|pin[-\\s]?(?:code|number|kode)|(?:your|the|card|bank)\\s+pin|login\\s+(?:details|credentials|info(?:rmation)?)|log-?in\\s+details|username\\s+and\\s+password|(?:your|login|log-?in|account|bank(?:ing)?)\\s+credentials|adgangskode)", gate: "cred" },
  { id: "credential_request", re: "(?:social\\s+security\\s+(?:number|no\\.?)|ssn|cpr(?:[-\\s]?(?:nummer|number|nr\\.?))?|personnummer)", gate: "cred" },

  { id: "credential_request", re: "(?:bank\\s+)?account\\s+(?:number|details|info(?:rmation)?)(?:\\s+and\\s+(?:the\\s+)?(?:routing|sort)\\s+(?:number|code))?|routing\\s+number|bank(?:ing)?\\s+(?:details|info(?:rmation)?|login)", gate: "cred" },
  { id: "credential_request", re: "(?:send|give|tell|provide|read|share|forward|text)\\s+(?!you\\b)(?:me\\s+|us\\s+)?(?:\\w+\\s+){0,4}?(?:the\\s+|your\\s+|that\\s+|this\\s+)?(?:code|codes)", gate: "cred-inline" },

  // v3: remote-access apps. Brand names fire on their own; the generic phrase needs an install verb.
  { id: "remote_access", re: "any\\s*desk|team\\s*viewer|quick\\s*support|quick\\s*assist|rust\\s*desk|ultra\\s*viewer|ammyy(?:\\s+admin)?|logmein|splashtop|supremo|screenconnect", gate: "remote-brand" },
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

  // "a time" is a schedule. Bare "pay when you pick" is still the handover.
  { id: "pay_on_collection", re: "pay\\s+when\\s+you\\s+pick(?!\\s+a\\s+time\\b)(?:\\s+it\\s+up)?", gate: "none" },
  // "it", "them", or one word ("the lamp") may sit between pick and up.
  // "when you pick a time" has no "up", so it does not match.
  // "when you pick up the phone" still matches "when you pick up".
  { id: "pay_on_collection", re: "when\\s+you\\s+pick(?:\\s+(?:it|them|(?:the|a|an|your|this|that|my|our|his|her|their)\\s+[\\p{L}\\p{N}]+))?\\s+up", gate: "none" },
  { id: "pay_on_collection", re: "cash\\s+on\\s+(?:pick\\s*up|collection)", gate: "none" },
  { id: "pay_on_collection", re: "cash\\s+when\\s+you\\s+pick(?!\\s+a\\s+time\\b)", gate: "none" },
  { id: "pay_on_collection", re: "pay\\s+on\\s+(?:pick\\s*up|collection)", gate: "none" },
  { id: "pay_on_collection", re: "on\\s+pick\\s*up", gate: "none" },
  { id: "pay_on_collection", re: "at\\s+pick\\s*up", gate: "none" },
  { id: "pay_on_collection", re: "betal(?:ing)?\\s+ved\\s+afhentning", gate: "none" },
  { id: "pay_on_collection", re: "ved\\s+afhentning", gate: "none" },
  { id: "pay_on_collection", re: "når\\s+du\\s+henter", gate: "none" },
  { id: "pay_on_collection", re: "through\\s+the\\s+(?:\\w+\\s+){0,3}checkout", gate: "checkout" },
  { id: "pay_on_collection", re: "(?:the|platform(?:ens)?|marketplace)\\s+checkout", gate: "checkout" },
  { id: "pay_on_collection", re: "brug\\s+(?:platformens\\s+)?checkout", gate: "checkout" }
];

const GS = wordBound("goods\\s*(?:&|and)\\s*services|varer\\s+og\\s+tjenester|G&S", "iu");
const PICKUP_ALT = /or\s+you\s+can\s+pick|or\s+pick\s*up|ship\s+or\s+(?:you\s+can\s+)?pick|eller\s+(?:du\s+kan\s+)?(?:hente|afhent)/iu;
const REFUSAL = /(?:(?:no|not|don't|dont|do\s+not|won't|wont|ikke|nej)\s+(?:\w+\s+){0,4}|avoid\s+(?:using|sending|paying)\s+(?:\w+\s+){0,3})(?:goods(?:\s*(?:&|and)\s*services)?|g&s|varer\s+og\s+tjenester)/iu;

function hasPayWord(text) {
  PAY_WORD.lastIndex = 0;
  return PAY_WORD.test(String(text ?? ""));
}

function payWordNear(text, start, end, window) {
  const slice = text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
  return hasPayWord(slice);
}

// Own clause after a refusal of Goods & Services or checkout.
// "only visit" and "my friends and family only" do not qualify.
const DICTATED_ONLY = /^(?:friends\s+(?:and|&)\s+family|family\s+(?:and|&)\s+friends)\s+only$/iu;
const SAFE_RAIL_REFUSAL = /(?:never|do\s+not|don['’]?t|dont)\s+(?:use|pay)\b[^]{0,80}?(?<![\p{L}\p{N}])(?:goods\s*(?:&|and)\s*services|g&s|checkout)(?![\p{L}\p{N}])/iu;
const CLAUSE_EDGE = /(?<!\d),(?!\d)|;|—|–|\s-\s|[.!?\n]/u;

function breakEndBefore(text, index) {
  const re = new RegExp(CLAUSE_EDGE.source, "gu");
  let end = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0;
    if (text[at] === "." && text[at - 1] >= "0" && text[at - 1] <= "9" && text[at + 1] >= "0" && text[at + 1] <= "9") continue;
    const after = at + match[0].length;
    if (after <= index) end = after;
    else break;
  }
  return end;
}

function sentenceFromAt(text, index) {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "!" || ch === "?" || ch === "\n") return i + 1;
    if (ch !== ".") continue;
    const prev = text[i - 1] || "";
    const next = text[i + 1] || "";
    if (prev >= "0" && prev <= "9" && next >= "0" && next <= "9") continue;
    return i + 1;
  }
  return 0;
}

function familyPivot(text, start) {
  const before = text.slice(0, start);
  const cue = /(?:never|do\s+not|don['’]?t|dont)\s+(?:send|pay|use)|avoid\s+(?:sending|paying|using)|aldrig\s+(?:send|betal|brug)|(?:send|betal)\s+aldrig|lad\s+være\s+med\s+at/iu;
  const match = cue.exec(before);
  if (!match) return false;
  const between = before.slice(match.index + match[0].length);
  return /[;:]|(?<!\d),(?!\d)|[.!?\n]|(?<![\p{L}\p{N}])(?:but|instead|however|rather|men)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])i\s+stedet(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:use|brug)(?![\p{L}\p{N}])/u.test(between);
}

function useRailAsk(text, start) {
  const before = text.slice(Math.max(0, start - 16), start);
  if (!/(?<![\p{L}\p{N}])(?:use|brug)\s+$/iu.test(before)) return false;
  const after = text.slice(start, Math.min(text.length, start + 48));
  if (/(?<![\p{L}\p{N}])(?:instead|i\s+stedet)(?![\p{L}\p{N}])/iu.test(after)) return true;
  return amountNear(text, start, start, 80);
}

function dictatedFamilyOnly(text, start, end) {
  const from = breakEndBefore(text, start);
  const rest = text.slice(end);
  const cut = rest.search(new RegExp(CLAUSE_EDGE.source, "u"));
  const clause = text.slice(from, cut === -1 ? text.length : end + cut).trim();
  if (!DICTATED_ONLY.test(clause)) return false;
  return SAFE_RAIL_REFUSAL.test(text.slice(sentenceFromAt(text, start), start));
}

function mobilePayToSeller(text, start, end) {
  const near = amountSpans(text).some((amount) => {
    const point = amount.end <= start ? amount.end : amount.start;
    const gap = amount.end <= start ? start - amount.end : amount.start >= end ? amount.start - end : 0;
    if (gap > 40 || clauseBreakBetween(text, point, start)) return false;
    return !/[—–]|\s-\s/u.test(text.slice(Math.min(point, start), Math.max(point, start)));
  });
  if (!near) return false;
  const from = breakEndBefore(text, start);
  const rest = text.slice(end);
  const cut = rest.search(new RegExp(CLAUSE_EDGE.source, "u"));
  const clause = text.slice(from, cut === -1 ? text.length : end + cut);
  // "was a refund" and "yesterday" name a past payment, not an ask.
  if (/(?<![\p{L}\p{N}])(?:was|were|yesterday|refund|refunded|already)(?![\p{L}\p{N}])/iu.test(clause)) return false;
  return /(?<![\p{L}\p{N}])(?:to\s+me|til\s+mig)(?![\p{L}\p{N}])/iu.test(clause);
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

function clauseBreakBetween(text, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return /[.!?;]|(?<!\d),(?!\d)/u.test(text.slice(lo, hi));
}

// transfer/wire unlocks an IBAN-like span only when an amount shares its
// clause. "transfer the bike, frame no. WT12…" has no amount. A price in
// the previous sentence does not count.
function transferAskNear(text, start, end, window) {
  const from = Math.max(0, start - window);
  const to = Math.min(text.length, end + window);
  const re = /(?<![\p{L}\p{N}])(?:transfer|wire)(?![\p{L}\p{N}])/giu;
  for (const match of text.slice(from, to).matchAll(re)) {
    const verbAt = from + (match.index ?? 0);
    const verbEnd = verbAt + match[0].length;
    if (clauseBreakBetween(text, verbEnd, start)) continue;
    const money = amountSpans(text).some((amount) => {
      const gap = amount.end <= start ? start - amount.end : amount.start >= end ? amount.start - end : 0;
      if (gap > window) return false;
      const amountAt = amount.end <= start ? amount.end : amount.start;
      return !clauseBreakBetween(text, verbEnd, amountAt) && !clauseBreakBetween(text, amountAt, start);
    });
    if (money) return true;
  }
  return false;
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

// Words that can sit between "don't use / don't pay" and the checkout phrase.
// An amount may contain a dot or comma (1.800, 1,800, $12.50).
const CHECKOUT_OBJECT = "(?:through|via|using|the|a|an|our|your|my|this|that|me|us|him|her|them|\\$?\\d+(?:[.,]\\d+)*|kr|dkk|eur|euro|usd|sek|gbp)";
// Same sentence only. "." "!" "?" ";" and a newline end it. A dot inside an
// amount does not. "outside", "except", "other than", "directly", and ", use"
// are advice to stay on checkout, so they keep the veto.
const CHECKOUT_STOP = /\b(?:outside|except|directly)\b|other\s+than|uden\s+for|,\s*(?:just\s+|bare\s+)?(?:use|brug)\b/iu;
const CHECKOUT_REFUSAL = new RegExp(
  `(?:don['’]?t|dont|do\\s+not|never)\\s+(?:use|pay|paying)\\s+(?:${CHECKOUT_OBJECT}\\s+)*$` +
    `|(?:brug\\s+ikke|betal\\s+ikke|ikke\\s+bruge|lad\\s+være\\s+med\\s+at\\s+bruge)\\s+(?:(?:gennem|via|på|i|over|\\$?\\d+(?:[.,]\\d+)*|kr|dkk|eur|euro|usd|sek|gbp)\\s+)*$`,
  "iu"
);
const CHECKOUT_IGNORE = /(?<![\p{L}\p{N}])(?:ignore|ignorer)\s+(?:(?:the|a|an|our|your|my|this|that)\s+)*$/iu;
const CHECKOUT_IGNORE_NEG = /(?:don['’]?t|dont|do\s+not|never|not|no|cannot|can\s+not|can['’]?t|won['’]?t|will\s+not|ikke|aldrig)\s+$/iu;

function checkoutClause(text, start) {
  const before = text.slice(0, start);
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === "!" || ch === "?" || ch === ";" || ch === "\n") return before.slice(i + 1);
    if (ch === ".") {
      const prev = before[i - 1];
      const next = before[i + 1];
      if (prev >= "0" && prev <= "9" && next >= "0" && next <= "9") continue;
      return before.slice(i + 1);
    }
  }
  return before;
}

function checkoutDismissed(text, start) {
  const clause = checkoutClause(text, start);
  if (CHECKOUT_STOP.test(clause)) return false;
  if (CHECKOUT_REFUSAL.test(clause)) return true;
  const ignore = clause.match(CHECKOUT_IGNORE);
  if (!ignore) return false;
  return !CHECKOUT_IGNORE_NEG.test(clause.slice(0, ignore.index));
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

// "Venmo me" and "Western Union the money" are asks. A pay word or an amount
// is not required. "Venmo payment protection" and a bare rail name are not.
function railDirectAsk(text, start, end) {
  const after = text.slice(end, Math.min(text.length, end + 48));
  if (/^\s+me\b/iu.test(after)) return true;
  return /^\s+(?:the|my|a)\s+(?:money|deposit|payment|funds)\b/iu.test(after);
}

// "payment protection" and "a payment app" name the product. "send" and "via" still count.
function namedRailPayNear(text, start, end) {
  const slice = text.slice(Math.max(0, start - 80), Math.min(text.length, end + 80));
  const stripped = slice.replace(/(?<![\p{L}\p{N}])payment\s+(?:protection|apps?)(?![\p{L}\p{N}])/giu, " ");
  return hasPayWord(stripped);
}

function railNegated(text, start) {
  const before = text.slice(Math.max(0, start - 48), start);
  // A list stays under the negation ("don't take Venmo or Zelle").
  // "so"/"but"/"men" start a new ask, and "not" inside "cannot" does not count.
  return /(?<![\p{L}\p{N}])(?:won't|wont|don't|dont|do\s+not|no|not|never|without|ikke|ingen|uden|nej|aldrig)(?![\p{L}\p{N}])(?:\s+(?!(?:so|but|men)(?![\p{L}\p{N}]))[\p{L}\p{N}]+){0,6}\s+$/iu.test(before);
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

function sentenceEndFrom(text, index) {
  for (let i = index; i < text.length; i++) {
    const ch = text[i];
    if (ch === "!" || ch === "?" || ch === "\n") return i;
    if (ch !== ".") continue;
    const prev = text[i - 1] || "";
    const next = text[i + 1] || "";
    if (prev >= "0" && prev <= "9" && next >= "0" && next <= "9") continue;
    return i;
  }
  return text.length;
}

// "send as gift" / "betal som gave" is the instruction. A gap ("500 kr", "it",
// "den") counts in the same sentence when that sentence names money or a pay
// rail. The opening verb is not that rail. "to an address" with neither is
// delivery. "overfør" and "MobilePay" as the verb are not covered here.
const GIFT_TIGHT = /^(?:send\s+as\s+(?:a\s+)?gift|(?:send|betal(?:e|ing)?)\s+som\s+gave)$/iu;
const GIFT_DELIVERY = /(?<![\p{L}\p{N}])(?:address|adresse)(?![\p{L}\p{N}])/iu;
const GIFT_PAY = /(?<![\p{L}\p{N}])(?:paypal|pay(?:ment|ing)?|paid|betal(?:e|ing)?|overf(?:ør|oer)(?:er)?|mobile\s*pay|venmo|zelle|cash\s*app|revolut|western\s+union|moneygram|swisha?|vipps|bitcoin|btc|usdt|crypto|iban)(?![\p{L}\p{N}])/iu;

function giftPayInSentence(text, from, to, verbAt) {
  const sentence = text.slice(from, to);
  const re = new RegExp(GIFT_PAY.source, "giu");
  for (const match of sentence.matchAll(re)) {
    const at = from + (match.index ?? 0);
    if (at === verbAt && /^betal/iu.test(match[0])) continue;
    return true;
  }
  return false;
}

function giftAskOk(text, start, end) {
  if (negatedBefore(text, start)) return false;
  const span = text.slice(start, end);
  const from = sentenceFromAt(text, start);
  const to = sentenceEndFrom(text, end);
  const inSpan = amountSpans(text).some((amount) => amount.start < end && amount.end > start);
  if (inSpan) return true;
  if (giftPayInSentence(text, from, to, start)) return true;
  if (GIFT_DELIVERY.test(text.slice(from, to))) return false;
  if (GIFT_TIGHT.test(span)) return true;
  return amountSpans(text).some((amount) => amount.start >= from && amount.end <= to);
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

// "I won't take PayPal F&F" refuses the rail. "Never send … via F&F" stays a
// hit so the prohibition layer can quiet it; that sentence is not "take".
function ffTokenOk(text, start) {
  if (negatedBefore(text, start)) return false;
  const before = text.slice(Math.max(0, start - 48), start);
  return !/(?<![\p{L}\p{N}])(?:won['’]?t|wont|will\s+not|don['’]?t|dont|do\s+not|never|not)\s+take(?:\s+[\p{L}\p{N}]+){0,4}\s+$/iu.test(before);
}

// "Do not install AnyDesk" refuses. The verb may sit between the negation and the brand.
// "Don't worry, install AnyDesk" stays an ask. "The quick support I got" is not a tool.
const REMOTE_BRAND_GAP = "(?:installer|install|download|open|use|run|hent|åbn|the|an|a)";
const REMOTE_BRAND_REFUSAL = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:won['’]?t|wont|don['’]?t|dont|do\\s+not|never|not|no|without|ikke|ingen|uden|nej|aldrig)(?![\\p{L}\\p{N}])(?:\\s+${REMOTE_BRAND_GAP}){0,4}\\s+$`,
  "iu"
);

function remoteBrandOk(text, start, end) {
  const before = text.slice(Math.max(0, start - 48), start);
  if (REMOTE_BRAND_REFUSAL.test(before)) return false;
  const span = text.slice(start, end);
  if (!/^quick\s+(?:support|assist)$/iu.test(span)) return true;
  const sentence = sentenceAround(text, start, end);
  if (REMOTE_VERB.test(sentence.whole)) return true;
  if (/(?<![\p{L}\p{N}])(?:any\s*desk|team\s*viewer|rust\s*desk)(?![\p{L}\p{N}])/iu.test(sentence.whole)) return true;
  const named = /(?:the|some|that|this|your|our|their|an|a)\s+$/iu.test(sentence.before);
  const received = /^\s+i\s+got\b/iu.test(sentence.after) || /(?:got|received|had)\s+$/iu.test(sentence.before);
  return !(named || received);
}

function allow(rule, text, start, end) {
  if (rule.gate === "gift-ask") return giftAskOk(text, start, end);
  if (rule.gate === "upfront-window") return upfrontWindowOk(text, start, end);
  if (rule.spanNegation && phraseNegated(text, start, end)) return false;
  // Wider than negatedBefore: the refusal can sit a short clause back,
  // as long as it still targets this checkout phrase. See checkoutDismissed.
  if (rule.gate === "checkout") return !negatedBefore(text, start) && !checkoutDismissed(text, start);
  if (rule.gate === "none" || rule.gate === "deposit-specific") return !negatedBefore(text, start);
  if (rule.gate === "chat-pay") return paymentViaChat(text, start, end);
  if (rule.gate === "negation") return !negatedBefore(text, start);
  if (rule.gate === "ff-token") return ffTokenOk(text, start);
  if (rule.gate === "remote-brand") return remoteBrandOk(text, start, end);
  if (rule.gate === "ff-phrase") return payWordNear(text, start, end, 60);
  if (rule.gate === "ff-dictated") return dictatedFamilyOnly(text, start, end);
  if (rule.gate === "ff-pivot") return familyPivot(text, start);
  if (rule.gate === "deposit-word") {
    if (depositRejected(text, start, end)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
  }
  if (rule.gate === "reserve") {
    if (depositRejected(text, start, end)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
  }
  if (rule.gate === "iban") return payWordNear(text, start, end, 80) || transferAskNear(text, start, end, 80);
  if (rule.gate === "wire-bank") {
    if (negatedBefore(text, start)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
  }
  if (rule.gate === "acct") {
    // "Your account number: XXXX" on a bill or receipt is the reader's own account, not a payee.
    // Otherwise this stays as wide as the old negation gate, so a transfer plus an amount still fires.
    if (/your\s+(?:\w+\s+)?$/iu.test(text.slice(Math.max(0, start - 20), start))) return false;
    return !negatedBefore(text, start);
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
    return !SENTENCE_NEG.test(sentence.before) && !OFFICIAL.test(sentence.whole) && !/(?:promo|discount|coupon|rabat|dress|zip|post(?:al)?|qr|source|tracking|wifi)\s+codes?$/iu.test(text.slice(start, end));
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
    const money = amountSpans(text).length > 0;
    if (hasPayWord(text) && money) return true;
    if (negatedBefore(text, start)) return false;
    return mobilePayToSeller(text, start, end);
  }
  if (rule.gate === "named-rail" || rule.gate === "cashtag") {
    if (railNegated(text, start)) return false;
    if (handoverQuietsRail(text)) return false;
    const pay = rule.gate === "named-rail" ? namedRailPayNear(text, start, end) : payWordNear(text, start, end, 80);
    return pay || amountNear(text, start, end, 80) || railDirectAsk(text, start, end);
  }
  if (rule.gate === "local-rail") {
    if (railNegated(text, start)) return false;
    const pay = localPayNear(text, start, end, 80);
    const money = amountNear(text, start, end, 80);
    const scam = payFirstLanguage(text);
    if (handoverQuietsRail(text)) return false;
    if (pay && money) return true;
    if (useRailAsk(text, start)) return true;
    return scam && money;
  }
  // "PayPal me" includes the pay word. A nearby amount is required.
  if (rule.gate === "amount-near") {
    if (negatedBefore(text, start)) return false;
    return amountNear(text, start, end, 80);
  }
  // Money or a pay word nearby. A bare name does not fire.
  if (rule.gate === "pay-or-amount") {
    if (negatedBefore(text, start)) return false;
    return payWordNear(text, start, end, 80) || amountNear(text, start, end, 80);
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

function lower(word) {
  return String(word || "").toLowerCase();
}

function repeatedExtra(word, target) {
  if (word.length !== target.length + 1) return false;
  for (let i = 1; i < word.length; i++) {
    if (word[i] !== word[i - 1]) continue;
    if (word.slice(0, i) + word.slice(i + 1) === target) return true;
  }
  return false;
}

function missingVowel(word, target) {
  if (word.length + 1 !== target.length) return false;
  const vowels = "aeiouyæøå";
  for (let i = 0; i < target.length; i++) {
    if (!vowels.includes(target[i])) continue;
    if (target.slice(0, i) + target.slice(i + 1) === word) return true;
  }
  return false;
}

function adjacentSwap(word, target) {
  if (word.length !== target.length) return false;
  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] === word[i + 1]) continue;
    const swapped = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
    if (swapped === target) return true;
  }
  return false;
}

// A single doubled letter, a missing vowel, or one adjacent swap.
// Deleting a consonant ("friend" for "friends") is left to the exact rule.
function typoKind(word, target) {
  const w = lower(word);
  const t = lower(target);
  if (!w || !t) return "";
  if (w === t) return "exact";
  if (repeatedExtra(w, t) || missingVowel(w, t) || adjacentSwap(w, t)) return "typo";
  return "";
}

function bestKind(word, targets) {
  let kind = "";
  for (const target of targets) {
    const next = typoKind(word, target);
    if (next === "typo") return "typo";
    if (next === "exact") kind = "exact";
  }
  return kind;
}

function tokensOf(text) {
  const out = [];
  for (const match of String(text).matchAll(/[\p{L}\p{N}]+|&/gu)) {
    out.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

function onlySpace(text, from, to) {
  return /^\s*$/u.test(text.slice(from, to));
}

function typoPair(leftWord, rightWord, leftTargets, rightTargets) {
  const leftKind = bestKind(leftWord, leftTargets);
  const rightKind = bestKind(rightWord, rightTargets);
  if (!leftKind || !rightKind) return false;
  return !(leftKind === "exact" && rightKind === "exact");
}

function findTypoAtoms(text) {
  const source = String(text ?? "");
  const found = [];
  const tokens = tokensOf(source);
  const orders = [
    [["friends", "venner"], ["family", "familie"]],
    [["family", "familie"], ["friends", "venner"]]
  ];
  for (let i = 0; i < tokens.length - 2; i++) {
    const left = tokens[i];
    const mid = tokens[i + 1];
    const right = tokens[i + 2];
    if (!/^(?:and|&|og)$/iu.test(mid.word)) continue;
    if (!onlySpace(source, left.end, mid.start) || !onlySpace(source, mid.end, right.start)) continue;
    const matched = orders.some(([leftTargets, rightTargets]) => typoPair(left.word, right.word, leftTargets, rightTargets));
    if (!matched) continue;
    const start = left.start;
    const end = right.end;
    if (!allow({ gate: "ff-phrase" }, source, start, end)) continue;
    const meta = META.friends_family;
    found.push({
      atom: "friends_family",
      text: source.slice(start, end),
      start,
      end,
      role: meta.role,
      strength: meta.strength,
      receipt: meta.receipt,
      gate: "ff-phrase"
    });
  }
  for (const token of tokens) {
    if (bestKind(token.word, ["deposit", "deposits", "depositum"]) !== "typo") continue;
    if (!allow({ gate: "deposit-word" }, source, token.start, token.end)) continue;
    const meta = META.upfront_deposit;
    found.push({
      atom: "upfront_deposit",
      text: token.word,
      start: token.start,
      end: token.end,
      role: meta.role,
      strength: meta.strength,
      receipt: meta.receipt,
      gate: "deposit-word"
    });
  }
  return found;
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
      const hit = {
        atom: rule.id,
        text: match[0],
        start,
        end,
        role: meta.role,
        strength: meta.strength,
        receipt: meta.receipt,
        gate: rule.gate
      };
      if (rule.gate === "named-rail" && railDirectAsk(source, start, end)) hit.directAsk = true;
      found.push(hit);
    }
  }
  found.push(...findTypoAtoms(source));
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
