# PayBrake: build spec

> Working name **PayBrake** (repo dir is `payguard/` as a placeholder; the final name may change). Keep the brand in ONE place per package: `extension/lib/brand.js` and `backend/src/brand.js`, plus README and manifest. A rename must be a single grep-replace.

Chrome MV3 extension that reads a marketplace chat the user has open, detects a **risky payment request** (Friends & Family for goods, upfront deposit or "hold" fee, off-platform payment such as MobilePay / IBAN / bank transfer / crypto / gift card, pressure and urgency, ship-before-pay), and shows a small in-page risk card with two actions:

- **Move to protected PayPal order**: the backend creates a **PayPal sandbox Orders v2** order (intent `CAPTURE`, payee = seller email, item + amount from the chat), the user approves in sandbox checkout, the backend captures, and the card shows the order ID and status.
- **Pay anyway**: dismisses the card and logs the override locally. Nothing is ever posted, typed, or clicked in the chat.

Hackathon: PayPal AI Hackathon on Devpost, deadline **Thu 12 Nov 2026 12:00 PT (21:00 Copenhagen)**. Rules that shape this spec: PayPal sandbox + an AI tool must be central; judges must be able to run a working build; the repo is public with an OSS license (MIT); the video is under 3 min with no third-party trademarks (so the demo surface is our own fictional page, never a real social network).

## 0. Non-negotiables

1. **Precision first. Silent unless evidenced.** A false alarm on a normal chat is the product failure; a miss is acceptable. The card appears only when at least one regex atom matched a concrete span in the text AND (when an LLM is configured) the LLM confirms with an evidence quote that is a verbatim substring of the input. The LLM can never raise a risk that no atom saw.
2. **Copy rule.** UI and docs say PayPal Buyer Protection **"may be eligible"**. Never "guaranteed", "you are protected", "100% safe", or a bare "eligible". Add a test that greps `extension/`, `demo/`, `README.md` for `guarantee`, `you are protected`, `100% safe` and fails on a hit.
3. **Secrets never ship in the extension.** The PayPal client secret and any LLM key live only in `backend/.env` (gitignored). `backend/.env.example` lists names with empty values. The extension talks only to the backend URL set in options (default `http://localhost:8787`).
4. **Sandbox only.** The backend refuses to start unless `PAYPAL_ENV=sandbox` (base URL `https://api-m.sandbox.paypal.com`).
5. **No real people, no Meta branding.** Demo pages and eval cases are synthetic with fictional names. No Facebook/Messenger/Meta names, logos, colours or DOM in `demo/`. Feed Lens Facebook/X/LinkedIn selectors are NOT copied.
6. **No network in `npm test`.** All tests run offline with mocks. Live checks are separate scripts that skip cleanly when creds are absent.
7. Plain ES modules, Node 20, no build step for the extension (load unpacked from `extension/`). Backend: Node 20 with `node:http` or one tiny framework (`hono` or `express`); keep deps minimal.

## 1. Repo layout

```
.
├── LICENSE                     MIT, 2026, Dmitrii Babinov and Christopher Wang
├── README.md                   what, why, run in 5 min, demo, architecture, limits
├── SPEC.md                     this file
├── package.json                root scripts (npm workspaces: extension, backend)
├── .gitignore                  node_modules, .env, .env.*, !.env.example, *.log
├── extension/
│   ├── manifest.json           MV3; content script on http://localhost/*, http://127.0.0.1/*
│   ├── background.js           message bus: detect → cache → backend calls; override ring log
│   ├── content.js              adapter rows (SITES) → extract chat messages → send → render card
│   ├── card.css                risk card styles (namespaced .pb-*, Shadow DOM)
│   ├── options.html/.js/.css   backend URL, LLM on/off, override log viewer + download
│   └── lib/
│       ├── brand.js            NAME, tagline
│       ├── atoms.js            regex atoms, RULES_VERSION, thresholds
│       ├── pay-risk.js         detect(text, ctx, {askLlm}) → Verdict (pure, testable)
│       ├── extract.js          amount/currency/item/payee-email extraction (pure)
│       ├── tidy.js             text cleanup helpers (pattern ported, see §3)
│       └── ask-llm.js          LLM adapter (calls backend /api/classify, never a provider directly)
├── backend/
│   ├── package.json
│   ├── .env.example            PAYPAL_CLIENT_ID= PAYPAL_CLIENT_SECRET= PAYPAL_ENV=sandbox PAYPAL_ADAPTER=rest LLM_BASE_URL= LLM_API_KEY= LLM_MODEL= PORT=8787 ALLOWED_ORIGINS=
│   ├── src/
│   │   ├── server.js           routes (§5), CORS allowlist, JSON body limit 16 kB
│   │   ├── paypal.js           OrdersPort: createOrder, getOrder, captureOrder (toolkit / rest / mock)
│   │   ├── agent.js            "protect" agent: verdict + deal → order args → PayPal tool call
│   │   ├── classify.js         LLM classify (OpenAI-compatible chat completions, JSON output)
│   │   └── brand.js
│   └── test/
│       ├── paypal.test.mjs     mocked fetch: token, create, get, capture, error paths
│       ├── server.test.mjs     route tests with mocked OrdersPort and mocked LLM
│       └── classify.test.mjs   prompt shape, JSON parse, evidence-substring guard
├── demo/
│   ├── marketplace.html        fictional marketplace chat (bike, 500 kr F&F deposit) + static mock card
│   ├── safe-chats.html         3 safe chats; the extension must stay silent
│   └── checkout-return.html    sandbox return/cancel landing (shows order id from query)
├── eval/
│   ├── cases/pay-risk.json     30 synthetic chats (§6)
│   └── run-eval.mjs            precision/recall, offline (rules) and live (rules+LLM)
├── tests/
│   ├── atoms.test.mjs          one fire + one near-miss negative per atom
│   ├── pay-risk.test.mjs       decision table, LLM gating, evidence guard
│   ├── extract.test.mjs        "500 kr", "DKK 1.800", "1,800 kr", "€45", item names
│   ├── copy.test.mjs           copy-rule grep (§0.2), no-Meta-branding grep on demo/
│   └── e2e/                    Playwright specs (§7.4, §7.5)
├── scripts/
│   ├── shot-demo.cjs           static demo screenshots (390, 1280)
│   └── live-sandbox.mjs        optional real sandbox create → approve link → capture; skips without creds
├── docs/adr/                   short decision records
└── shots/                      committed PNGs used in README and Devpost
```

## 2. Data contracts

```js
// Verdict from extension/lib/pay-risk.js
{
  kind: "silent" | "risk",
  level: "high" | "medium",          // only when kind === "risk"
  reason: "string <= 120 chars",     // one line, plain English, no guarantee language
  signals: ["friends_family", "upfront_deposit"],
  evidence: [{ atom: "friends_family", text: "Friends & Family", start: 23, end: 39 }],
  deal: { item: "Used road bike", amount: 1800, currency: "DKK", depositAmount: 500, payeeEmail: null },
  silentReason: "short" | "no_atom" | "weak_only" | "veto" | "llm_disagrees",   // only when silent
  llm: "confirmed" | "off" | "error",
  rulesVersion: 1
}
```

Message bus (content ↔ background): `pb:detect {text, hash, site, context:{listingTitle, listingPrice, sellerName, sellerEmail}}` → `{ok, verdict}`; `pb:protect {hash}` → `{ok, orderId, approveUrl, mode}`; `pb:status {orderId}` → `{ok, status}`; `pb:capture {orderId}` → `{ok, status}`; `pb:override {hash}` → `{ok}`; `pb:mark {hash}` → `{ok, mark}`.

## 3. What to port from Feed Lens (private repo: copy patterns, not content)

Feed Lens lives at `/workspace/feed-lens` (private, stays private). Port these **code patterns** by rewriting them into the new files; small helper functions may be copied verbatim. Do NOT copy `evals/gold.json`, `tune/`, `launch/`, `video-*`, `docs/HANDOFF.md`, `CONTEXT.md`, logs, `.env`, TypeSafe atoms/questions, or any Facebook/X/LinkedIn selectors.

| Feed Lens source | Reuse as | Notes |
|---|---|---|
| `lib/classify.js`: `silent(reason)`, the `decide()` AND + veto structure, `cleanText()`, early refusals in `classify()` (short text, model pin check, every expected score present before deciding) | `extension/lib/pay-risk.js` | Same shape: refusals first, then AND of evidence legs, then vetoes; always return a reason when silent. Regex atoms + optional LLM confirmation replace the TypeSafe score map. |
| `lib/atoms.js`: `RULES_VERSION`, thresholds as named exports, `ATOMS` table with `role: "act" / "veto"` and a human `receipt` string | `extension/lib/atoms.js` | Atoms become `{ id, role, strength: "strong"/"weak", receipt, patterns: [RegExp], needsNear?: RegExp }`. `RULES_VERSION` goes into the cache key. |
| `lib/ask-typesafe.js`: defensive `numberFrom()` / `scoresFromPayload()` parsing; error messages with status + first 160 chars of body; non-JSON guard | `extension/lib/ask-llm.js`, `backend/src/classify.js` | Same defensive JSON handling for LLM output. |
| `lib/tidy.js`: classic-script + ESM-compatible global pattern (`globalThis.feedLensTidy = {...}`) | `extension/lib/tidy.js` as `globalThis.pbTidy` | Keep the lesson in its comment: JS `\b` does not see non-ASCII letters. Danish (æøå: "overførsel", "forskud", "afhentning") needs explicit word matching or `u`-flag lookarounds. |
| `background.js`: `cacheKey()` (hash + rules version + model), memory + `chrome.storage.local` cache with TTL, ring log with `LOG_MAX` and debounced `flushLog()`, `markEntry()`, `onMessage` handler returning `true` for async | `extension/background.js` | Ring log stores overrides, miss/false marks: `{hash, signals, level, action, ts, head<=160 chars}`; local only; export from options. |
| `content.js`: `SITES` adapter table (selectors live only there), `extractPostText()` clone-strip-read approach, `hashText()` SHA-256, `sameHashNearby()`, queue with `MAX_INFLIGHT`, `MutationObserver` + interval rescan, `send()` wrapper that never throws, Alt+Shift+click miss marking, HUD (keep, behind a debug flag in options) | `extension/content.js` | One adapter row: `demo`, matching our own demo DOM (`[data-pb-thread]`, `[data-pb-msg][data-from="seller"]`, `[data-pb-listing-title]`, `[data-pb-listing-price]`, `[data-pb-seller-email]`). Leave a commented template row for a future real marketplace; do not ship one. Read seller messages plus the last buyer message for context. |
| `scripts/eval-gold.mjs`: per-case expect vs got loop, false-Act counter, exit 1 on any false Act, skip cleanly without key | `eval/run-eval.mjs` | Add precision/recall/F1 per mode; exit 1 below targets (§7.2). |
| `tests/classify.test.mjs` style: `baseScores()`, `askWith()` stubs, refusal tests asserting the model was never called | `tests/pay-risk.test.mjs` | Assert `askLlm` call count is 0 on short / no-atom / weak-only inputs. |
| `docs/adr/0001-precision-act-and.md` idea (AND + veto; a single shape never fires) | `docs/adr/0001-silent-unless-evidenced.md` | Rewrite in our own words. |

## 4. Pay-risk detector

### 4.1 Atoms (regex, case-insensitive, Unicode-aware; English + Danish minimum)

| id | role / strength | fires on (examples) | must NOT fire on |
|---|---|---|---|
| `friends_family` | act / strong | "Friends & Family", "friends and family", "F&F", "FnF", "send as gift", "personal payment", "venner og familie" | "my friends and family loved it" (requires a pay word within 60 chars: send, pay, via, PayPal, betal, overfør) |
| `upfront_deposit` | act / strong | "deposit", "hold it for you", "reservation fee", "pay half now", "forskud", "depositum", "reservere" with a pay word or amount | "no deposit needed", "bottle deposit", "deposit on collection" |
| `off_platform` | act / strong | MobilePay to a number, IBAN (`[A-Z]{2}\d{2}[A-Z0-9]{11,30}`), "bank transfer", "reg.nr / kontonr", Revolut/Wise link, crypto, gift card, "pay me on WhatsApp/Telegram", external pay links | IBAN-like serials without a pay word nearby |
| `pay_before_see` | act / strong | "pay first then I send", "payment before viewing", "betal først" | |
| `urgency_pressure` | act / weak | "several people are asking", "today only", "first to pay gets it", "within the hour", "mange interesserede" | never fires a card alone |
| `ship_before_meet` | act / weak | "I ship tomorrow", "can only ship", "I am abroad", "courier delivers after payment", "kan kun sende" | "I can ship or you can pick up" |
| `pay_on_collection` | veto | "pay when you pick it up", "cash on pickup", "betal ved afhentning", "through the checkout", "use the platform checkout" | |
| `goods_and_services_agreed` | veto | buyer proposes Goods & Services and the seller agrees in the same thread | |

`RULES_VERSION = 1`. Each atom returns evidence spans `{start, end, text}`.

### 4.2 Decision (rules)

- **risk/high**: two or more distinct strong atoms, or one strong + one weak; no veto.
- **risk/medium**: exactly one strong atom, with a pay word or an amount in the same message; no veto.
- Otherwise silent with `silentReason`. Weak atoms alone are always silent (`weak_only`). Any veto → silent `veto`.
- Text under 20 chars → silent `short`; the LLM is never called.

### 4.3 LLM confirmation (precision gate; optional, on for the demo)

- Called only when rules say risk. The extension calls backend `/api/classify`; the backend calls an OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_MODEL`; any provider), `temperature 0`, JSON output.
- Output: `{ "risky": bool, "level": "high"|"medium"|"none", "reason": "<=120 chars", "evidence": ["verbatim quote"], "item": str|null, "amount": number|null, "currency": str|null }`.
- Guards: every `evidence` string must be a verbatim substring of the input (whitespace-normalized), else silent `llm_disagrees`. `risky=false` → silent `llm_disagrees`. LLM error or 4 s timeout → rules-only result capped at **medium**, `llm: "error"`.
- The LLM may improve `reason`, `item`, `amount` and may lower the level; it can never raise it above the rules level.
- Sanitize `reason` server-side: drop guarantee language; fall back to a template per signal combo.

### 4.4 Extraction (`extension/lib/extract.js`)

Amounts: `500 kr`, `kr 500`, `DKK 1.800`, `1,800 kr`, `€45`, `45 EUR`, `$120` (map kr/DKK → DKK, € → EUR, $ → USD). Item and price come from page context (listing title/price) first, chat second. Payee email: from chat if present, else `data-pb-seller-email` on the demo page; if none, the card shows a small email field inside our own card (never the site's composer).

## 5. Backend (Node 20)

Routes (JSON; CORS allowlist from `ALLOWED_ORIGINS` plus `chrome-extension://*` of the loaded extension):

| route | does |
|---|---|
| `GET /health` | `{ok, env: "sandbox", paypal: "rest"/"toolkit"/"mock", llm: "configured"/"off"}` |
| `POST /api/classify` | `{text}` → LLM JSON (§4.3). 503 when LLM is off. |
| `POST /api/protect` | `{item, amount, currency, payeeEmail, verdict}` → agent creates order → `{orderId, status, approveUrl, mode}` |
| `GET /api/orders/:id` | → `{orderId, status}` |
| `POST /api/orders/:id/capture` | → `{orderId, status, captureId}` |
| `GET /return`, `GET /cancel` | PayPal redirect targets; redirect to `demo/checkout-return.html?token=...` |

`src/paypal.js` exposes an `OrdersPort` with three adapters, selected by env:

1. **`toolkit`** (the "AI + PayPal" story): `@paypal/agent-toolkit` (npm 1.11.x when this spec was written; subpath exports `./ai-sdk`, `./openai`, `./mcp`, `./langchain`). Configure `orders: { create: true, get: true }` and expose `create_order`, `get_order`, `pay_order` as tools to the agent in `src/agent.js` (OpenAI-compatible tool calling). The agent receives verdict + deal and must call `create_order` with the extracted item and amount. **Check whether the toolkit's `create_order` schema supports `payee.email_address`**; if not, the agent still chooses the arguments but execution goes through the `rest` adapter. Write what you found in README.
2. **`rest`** (always present, used by tests): OAuth `POST /v1/oauth2/token` (client credentials; cache until `expires_in - 60 s`), `POST /v2/checkout/orders` with `intent: "CAPTURE"`, `purchase_units[0] = { reference_id, description: item, amount: { currency_code, value: "1800.00" }, payee: { email_address } }`, `payment_source.paypal.experience_context = { return_url, cancel_url, user_action: "PAY_NOW" }`; approve URL = the link with `rel` `payer-action` (fallback `approve`). `GET /v2/checkout/orders/{id}`, `POST /v2/checkout/orders/{id}/capture`. Send a `PayPal-Request-Id` uuid on POSTs. Format amounts with 2 decimals; support DKK, EUR, USD.
3. **`mock`** when `PAYPAL_CLIENT_ID` is empty: deterministic `MOCK-<uuid>` IDs, approve URL to `demo/checkout-return.html?token=MOCK-...&mock=1`, status CREATED → APPROVED (on return) → COMPLETED (on capture). The card shows a "mock mode" tag.

Optional MCP path (stretch, document only if time): `npx -y @paypal/mcp --tools=all` with `PAYPAL_ENVIRONMENT=SANDBOX`, called from the agent via an MCP client. Not required for acceptance.

Never log secrets or tokens; log order IDs and statuses only.

## 6. Eval set (`eval/cases/pay-risk.json`, 30 synthetic chats)

Case shape: `{ id, lang: "en"|"da", expect: "risk"|"silent", level?, signals?, context: {listingTitle, listingPrice}, messages: [{from: "seller"|"buyer", text}] }`. Fictional names only.

At least 15 risky: F&F + deposit, IBAN transfer, MobilePay to a number before viewing, gift card, crypto, courier after payment, "I'm abroad, ship only", deposit to hold, plus 4 Danish variants. At least 15 safe: pay on pickup, platform checkout, Goods & Services at the buyer's request, "friends and family" in a non-payment sense, "deposit" in a non-payment sense (bottle deposit), IBAN-like serial number, urgency without a payment ask, normal tracked shipping via the platform, plus 4 Danish variants. At least 5 safe cases are **hard negatives** that share words with positives.

`node eval/run-eval.mjs --mode=rules` (offline, part of CI) and `--mode=live` (rules + LLM via a running backend; skips without `LLM_API_KEY`). Prints a table and writes `eval/report.json`.

## 7. Acceptance checks (all must pass; paste the output in the final message)

1. `npm test` at the root runs offline and passes: atoms (each atom: one fire, one near-miss), decision table, LLM gate (never called without an atom; `risky:false` silences; fabricated evidence silences; LLM error caps at medium), extraction, copy-rule grep, no-Meta-branding grep on `demo/`.
2. `npm run eval` (rules mode): **precision ≥ 0.95, zero false alarms on the safe cases, recall ≥ 0.80**. Live mode (when a key is present): precision ≥ 0.95, recall reported.
3. Backend tests with mocked `fetch` and no creds: token caching, create-order body (payee email, 2-decimal amount, currency, intent CAPTURE, `PayPal-Request-Id`), approve-link parsing, capture, 4xx/5xx error mapping, the sandbox-only guard refusing a live base URL; `/api/protect` in mock mode returns a `MOCK-` order and approve URL.
4. Playwright, Chromium at **390×844 (dpr 2)** and **1280×800**: open `demo/marketplace.html`; assert `#pb-card` visible and contains "High risk"; both buttons visible and ≥ 44 px tall at 390; the page contains "may be eligible" and no "guarantee". Save `shots/demo-390.png`, `shots/demo-1280.png`, `shots/demo-1280-protect.png`, and `shots/safe-1280.png` (from `demo/safe-chats.html`, no card).
5. Extension smoke (Playwright with `--load-extension=extension`, backend in mock mode): serve the repo at `http://localhost:8080`, open `demo/marketplace.html?live=1` (the `live=1` flag hides the static mock card so only the injected card shows); the live card appears within 5 s; click protect → card shows a `MOCK-` order id; click "Pay anyway" on a second risky thread → an override entry exists in the ring log. Save `shots/ext-live-1280.png`.
6. `git grep -nE "(sk-[A-Za-z0-9]{10,}|EAAG|A21AA|client_secret\s*[:=]\s*['\"][^'\"]+)"` returns nothing; `.env` is gitignored; `.env.example` has empty values.
7. README "Run in 5 minutes" works from a clean clone: `npm install`, `cp backend/.env.example backend/.env`, `npm run dev:backend`, `npm run serve:demo`, load unpacked `extension/`, open `http://localhost:8080/demo/marketplace.html?live=1`. Mock mode works with zero credentials; sandbox mode needs only `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.

## 8. UI and copy

- Card: Shadow DOM root, `.pb-*` classes. Badge "High risk payment request" or "Possible payment risk", one-line reason, evidence chips, primary "Move to protected PayPal order", secondary "Pay anyway", footer "PayBrake · AI check · only you can see this". Highlight evidence spans inside the message bubble by wrapping text nodes; never touch the site's input box.
- After order creation: "Sandbox order created · ID … · awaiting approval" + "Open approval". After capture: "Paid with PayPal Goods & Services (sandbox). Buyer Protection may be eligible; see PayPal terms."
- Fallback reason templates when the LLM is off, e.g. F&F + deposit: "Friends & Family + upfront deposit: if the item never arrives, you may have no way to get your money back."
- Visual reference: `demo/marketplace.html` in this repo (built from the concept mockup). PayPal appears only as a text wordmark; no PayPal logo files.
- Accessibility: buttons ≥ 44 px, focus rings, `aria-live="polite"` on the card status line, `prefers-reduced-motion` respected.

## 9. Out of scope

Auto-messaging sellers, real money, production keys, adapters for real social networks or marketplaces, any claim that protection is guaranteed, image OCR, user accounts.

## 10. Definition of done for the first build session

§7.1–7.4 and §7.6 green, §7.3 mock mode end to end, README run instructions written, `shots/` populated. §7.5 and the `toolkit` adapter may slip to the next session; if so, say exactly what is done and what is not.
