# PILOT-TASK: PayBrake live-chat pilot (Chrome MV3, unpacked)

You are a coding agent working in `/workspace/payguard`. Build ONLY the pilot described here, inside `pilot/extension/`. Do not touch `extension/`, `backend/`, `demo/` or `SPEC.md` (that is the separate hackathon build). Commit locally when done (`git add pilot && git -c user.name="PayBrake agent" -c user.email="agent@localhost" commit -m "pilot: live chat extension"`); never add a remote, never push, never create a GitHub repo. Shell: `bash --norc`. Only kill PIDs you started.

## Why
Dima's teammate plays a scammer in a real web chat (www.facebook.com/messages, www.facebook.com/marketplace, www.messenger.com) asking for a deposit via PayPal Friends & Family / MobilePay / bank transfer with urgency and "shipping only". The extension must notice the incoming request and show the PayBrake risk card under that message, so we can take screenshots for a hackathon demo. Precision first: silent on normal chats. Nothing is ever typed, clicked or sent in the chat.

## Already written (do not rewrite; make them pass)
- `pilot/fixtures/messenger-thread.html`: local fixture with the chat DOM shape (`[role="main"]` > `[role="grid"]` > `[role="row"]` > ... > `div[dir="auto"]` text; hidden `h5` sender headings "You sent" / other person's name; outgoing rows right-aligned with `.rowin.me`, BUT do not rely on fixture class names, see "Reading messages"). `window.fixture.rerender()` replaces all row nodes with clean copies.
- `pilot/tests/cases.json` + `pilot/tests/detector.test.mjs`: detector contract and 21 cases (11 must stay silent). Run `cd pilot && node --test tests/`.
- `pilot/tests/e2e-pilot.cjs`: loads `pilot/extension` unpacked in Chromium, serves the fixture at real chat URLs via route interception, checks card behaviour, writes `shots/pilot-1280.png`, `pilot-390.png`, `pilot-order-1280.png`, `pilot-order-created-1280.png`, `pilot-anyway-1280.png`, `pilot-safe-1280.png`. Run `cd pilot && node tests/e2e-pilot.cjs`. Read it: it is the DOM/API contract.
- `pilot/scripts/package.sh`: writes `dist/paybrake-pilot.zip`.

You may fix a genuine bug in a test file, but never weaken a check or delete a case to make it pass; if you change a test, say why in the final summary.

## Files to write (`pilot/extension/`, plain JS, no build step, no dependencies, no network)
```
manifest.json      MV3, name "PayBrake (pilot)", version 0.1.0, description "Flags risky payment requests in marketplace chats." (no social network names in name/description)
lib/detector.js    classic script, sets globalThis.PayBrakeDetector = { RULES_VERSION, detect, parseAmount }; pure, no DOM
content.js         adapter + observer + card renderer (Shadow DOM)
card.css           OPTIONAL; easier to inline the card CSS as a string in content.js for the shadow root
background.js      service worker: opens order page, writes the log
order.html/.js/.css mock "protected order" page (extension page)
options.html/.js   two checkboxes + log viewer (see below)
icons/             optional simple generated PNGs (16/48/128), abstract shape, no third-party logos
```
manifest: `permissions: ["storage"]`; `host_permissions` and content script `matches`: `https://www.facebook.com/messages/*`, `https://www.facebook.com/marketplace/*`, `https://www.messenger.com/*`. Content scripts: `["lib/detector.js","content.js"]`, `run_at: "document_idle"`, `all_frames: false`. `background.service_worker: "background.js"`. `options_page: "options.html"`. No `web_accessible_resources` needed (order page is opened by the background via `chrome.tabs.create`, which needs no `tabs` permission).

Facebook is a single-page app: the user often lands on `/` and navigates to `/messages/...` without a reload, so the content script would not be injected. Also add a second content-script entry matching `https://www.facebook.com/*` that runs the same files, and inside content.js make all scanning a no-op unless `location.pathname` starts with `/messages` or `/marketplace` (re-check on every observer tick; SPA URL changes). Messenger.com: always active.

## Detector (`lib/detector.js`)
`detect(text, { context = [] } = {}) → Verdict`. `text` = newest incoming message; `context` = up to 4 earlier incoming messages in the same thread (oldest first). Must never throw (non-strings → treat as ""), deterministic, no Date/random.

Verdict:
```js
{ kind: "risk" | "silent",
  level: "high" | "medium",            // risk only
  reason: "one line <= 160 chars, quotes >=1 evidence span verbatim, e.g. “500 kr deposit” via “Friends & Family”: if the item never arrives, you may have no way to get your money back.",
  signals: ["friends_family","mobilepay","bank_transfer","deposit","urgency","ship_only"],
  evidence: [{ atom, text }],          // text = verbatim substring of text or a context message
  deal: { amount: 500|null, currency: "DKK"|"EUR"|"USD"|null, depositAmount: 500|null, priceAmount: 1800|null },
  silentReason: "short"|"no_pay_method"|"no_money"|"veto"|"weak_only",   // silent only
  rulesVersion: 1 }
```
Atoms (case-insensitive, Unicode-aware; JS `\b` does NOT work next to æøå, use `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])` with the `u` flag):
- **pay-method risk** (the leg that must be present):
  - `friends_family`: "friends and family", "friends & family", "F&F", "FnF", "send as gift", "personal payment", "venner og familie", "venner & familie". "friends and family" / "venner og familie" spelled out count only with a pay word within 60 chars (pay, send, paypal, via, betal, overfør, send); "my friends and family all loved this lamp" must stay silent.
  - `mobilepay`: "MobilePay", "mobile pay", "MP til" / "MP to" + phone number.
  - `bank_transfer`: "bank transfer", "wire transfer", "bankoverførsel", "overførsel", "overfør til min konto", "IBAN" or an IBAN-shaped token `[A-Z]{2}\d{2}[A-Z0-9]{11,30}` only with a pay word within 60 chars, "reg.nr" / "reg nr" / "registreringsnummer", "kontonummer" / "kontonr" / "konto nr", "account number", "sort code".
- **money/deposit evidence** (second leg):
  - `deposit`: "deposit", "depositum", "forudbetaling", "forskud", "pay first", "betal først", "pay upfront", "up front", "reserve/reservation fee", "hold it for you", "reservere", "holder ... til dig". NOT when negated: "no deposit", "no need for a deposit", "ingen depositum", "uden depositum", and NOT "bottle deposit" / "pant" / "return them for the deposit" (refund of returnables).
  - an amount parsed by `parseAmount` (see below) in the text or context.
- **weak** (never fire alone, raise medium → high): `urgency`: "today only", "only today", "others are interested", "several people", "a lot of people", "lots of interest", "first come", "quick"/"quickly", "asap", "hurtigt", "hurtig", "i dag", "mange er interesserede", "mange interesserede", "flere er interesserede", "først til mølle". `ship_only`: "only shipping", "shipping only", "can only ship", "I'm abroad", "I am abroad", "courier", "kun forsendelse", "kan kun sende", "sender med post", "I post it", "I send it".
- **veto** (silent `veto`) — applies ONLY if there is no `deposit` atom (scammers say "deposit now, rest on pickup"): pay on pickup / in person: "when you pick", "on pickup", "at pickup", "cash on pickup", "pay when we meet", "ved afhentning", "når du henter", "når du kommer", "kontant", "cash", "through the checkout", "marketplace checkout", "goods and services", "goods & services", "G&S".

Decision, evaluated on `context + text` combined, but evidence must come from real spans:
1. `text.trim().length < 12` → silent `short`.
2. Newest message alone must contain at least one atom of any kind (pay-method, deposit, urgency, ship_only, or amount); otherwise silent `no_pay_method` (we attach the card only to the message that completes the picture).
3. Veto (see above) → silent `veto`.
4. No pay-method atom in text+context → silent `no_pay_method`. Pay method but no deposit atom and no amount → silent `no_money`.
5. Risk **high**: pay-method + deposit; or pay-method + amount + (urgency or ship_only); or ≥2 distinct pay-method atoms + amount. Otherwise **medium** (pay-method + amount).
6. Urgency/ship_only only → silent `weak_only`.
`deal`: `parseAmount` over newest message first, then context newest-first. `depositAmount` = amount within ~30 chars of a deposit atom; `priceAmount` = amount near "price/pris/costs/koster" or the largest other amount. `amount` = depositAmount ?? first amount found. In test case `en-context-split`, amount must be 500 (the deposit), not 1800.
`parseAmount(str)` → `[{ value, currency, text, index }]`: "500 kr", "500kr", "kr 500", "kr. 500", "DKK 1.800", "1.800 kr", "1,800 kr", "1800,-", "500 kroner", "€150", "€ 150", "150 EUR", "150 euro", "$120", "120 USD". Danish thousands separator "." (1.800 → 1800); "1,800" with exactly 3 digits after comma → 1800; "12,50" → 12.5. kr/kroner/DKK/",-" → DKK. Phone numbers like "20 12 34 56" or "22 33 44 55" are NOT amounts (an amount needs a currency marker). Card numbers / account numbers are not amounts.
Reason templates (choose by strongest combo; quote evidence spans with “ ”; English only for the pilot; never "guaranteed", "you are protected", "100% safe"; Buyer Protection copy only on order page as "may be eligible"):
- F&F + deposit: `“{deposit}” via “{ff}”: if the item never arrives, you may have no way to get your money back.`
- MobilePay/bank + deposit: `Upfront “{deposit}” by “{method}”: a direct transfer outside PayPal is very hard to get back.`
- method + amount (+ ship/urgency): `“{amount}” by “{method}” before you see the item: hard to get back if it never arrives.`
Truncate to 160 chars with "…" if needed but keep at least one full quoted span.

## Reading messages (`content.js`)
- One `ADAPTER` object at the top holds ALL selectors (so they can be fixed live in one place): thread root candidates `[role="main"]` and chat popups `[role="dialog"]`, `[aria-label*="Chat" i]`; message rows `[role="row"]`; text nodes `div[dir="auto"]`; strip `h1..h6`, `[role="button"]`, `[aria-hidden="true"]`, `time`, our own `[data-paybrake]`; thread title = first `h1`/`h2` text in the thread root, else `document.title` minus a " | ..." suffix.
- Message text = join of `div[dir="auto"]` texts in the row that are not inside a stripped element (dedupe nested dir=auto: take only the outermost). Ignore rows with < 2 chars of text.
- Direction (who sent it), in order: (a) row contains a heading/text node exactly "You sent", "Du sendte", "Du har sendt", "You:" → mine; another short heading → theirs; (b) geometry: centre of the text element's bounding box vs centre of the row (or of the grid): right of centre + 10% → mine, else theirs. Headings appear only on the first bubble of a run, so if (a) is absent fall through to (b). Default to theirs only when geometry is unavailable (width 0) — and then require level high.
- Options (chrome.storage.local `pb_opts`): `checkOwn` (default false; when true, my own messages are also checked; used to rehearse alone) and `debug` (default false; logs `[PayBrake]` lines to console, and outlines scanned rows). LLM: none in the pilot; leave a `// LLM confirm hook (off)` comment only.
- `MutationObserver` on `document.body` (childList + subtree + characterData), debounced ~300 ms, plus a 2 s interval rescan. Keep work small: only rows inside the thread roots; skip rows whose current text hash (fast string hash is fine) was already processed with the same result; cache verdicts in a `Map` by hash.
- Context window per row = up to 4 previous incoming rows in the same thread root (document order).
- Must not break the page: wrap every callback in try/catch; never throw from observers; never `preventDefault`; never modify the site's nodes except (1) appending our card host as the LAST child of the flagged `[role="row"]` and (2) setting `data-paybrake-flagged="1"` on the flagged `div[dir="auto"]` (style via a tiny global `<style data-paybrake>` with an amber outline; no text-node wrapping, no innerHTML on site nodes). Never touch `[role="textbox"]`, `contenteditable`, inputs, or the send button. Never call `.click()` or dispatch events on site elements.
- Re-attach: if the row is re-rendered and our host disappears, the next scan re-attaches it (same hash → cached verdict). Exactly one card per message. If the user pressed "Pay anyway" for that hash, re-attach the collapsed state, not the full card.
- Set `document.documentElement.dataset.paybrake = "on"` when the script is active on an allowed path (the e2e test waits for it), and remove nothing else.

## Card (Shadow DOM, styled like `demo/marketplace.html` `.pb` card)
Host: `<div data-paybrake="card" data-pb-hash="...">` with `attachShadow({mode:"open"})`; all CSS inside the shadow root (copy the `.pb`, `.pb-body`, `.pb-top`, `.risk-badge`, `.pb-explain`, `.chips`, `.chip`, `.actions`, `.btn`, `.btn-primary`, `.btn-ghost`, `.pb-foot`, `.pb-collapsed` rules and the colour variables from `demo/marketplace.html`; the left amber→red stripe; same warning triangle SVG). `all: initial` on `:host`, `display:block`, max-width 560px, margin 6px 0 10px 36px (0 left margin under 520 px), font-family system-ui, `color-scheme: light` so dark mode does not invert it; z-index not needed (in flow).
Content: badge "High risk payment request" (level high) or "Possible payment risk" (medium); tag "Checked just now"; `.pb-explain` = verdict.reason; "Detected signals" chips with human labels (Friends & Family, MobilePay, Bank transfer, Upfront deposit, Pressure to hurry, Shipping only); buttons `<button data-pb-action="protect" class="btn btn-primary">Switch to a PayPal order</button>` and `<button data-pb-action="anyway" class="btn btn-ghost">Pay anyway</button>` (≥ 44 px tall; full width stacked under 520 px card width — use a container query or `@media (max-width:520px)`); footer "PayBrake · on-device check · only you can see this". Stop click propagation inside the shadow root so the site's handlers do not react. `aria-live="polite"` on the footer. Focus rings visible. `prefers-reduced-motion` respected. No third-party logos (PayPal only as plain text).
- Protect → `chrome.runtime.sendMessage({type:"pb:protect", deal, item, seller, hash, signals, reason})`; background opens `order.html?d=<encodeURIComponent(JSON)>` with `chrome.tabs.create`; card footer updates to "Opened a protected order draft in a new tab".
- Pay anyway → `chrome.runtime.sendMessage({type:"pb:log", entry:{action:"pay_anyway", hash, signals, level, head: first 160 chars, url: location.origin + location.pathname, ts}})`; card collapses to "You chose to pay anyway. Logged on this device." (the e2e test looks for /pay anyway/i in the host text).
- Wrap `chrome.runtime.sendMessage` so an invalidated extension context (after reload) never throws.

## background.js
Handles `pb:protect` (opens tab; also logs `{action:"protect", ...}`) and `pb:log` (append to `chrome.storage.local.pb_log`, ring buffer max 200). `return true` for async responses. No network.

## order.html (extension page, our own design, reuse demo/marketplace.html side panel "Protected order preview" look)
Reads `?d=`. Shows: "Protected order preview" + "Sandbox demo" tag; "PayPal" text wordmark (no logo); Item (thread item: for "Christopher Wang · Used road bike" the item is the part after " · ", else "Item from chat"); Seller (part before " · ", or "Seller"); Payment type "Goods & Services"; `#order-amount` = formatted amount + currency (e.g. "500 kr" for DKK, "€150"); editable amount input is fine; Buyer Protection `<span class="maybe">may be eligible*</span>`; compare box "Seller asked for: {reason evidence}" vs "This order: Goods & Services, paid to the seller's account"; button `#order-create` "Create sandbox order (mock)" → shows "Sandbox order created · ID MOCK-XXXXXXXX · awaiting approval" (random hex is fine here); fineprint "*Eligibility depends on PayPal terms and the transaction. Mock pilot: no real order or payment is made." Responsive at 390 px. Never the words guarantee / you are protected / 100% safe.

## options.html
Checkboxes `checkOwn`, `debug`; list of the last 50 `pb_log` entries (time, action, signals, head); "Clear log" button; "Download log (JSON)".

## Verify (all must pass before you finish)
```
cd /workspace/payguard/pilot && node --test tests/ && node tests/e2e-pilot.cjs && bash scripts/package.sh
```
Then LOOK at every PNG in `/workspace/payguard/shots/pilot-*.png` (open them as images) and fix visual issues: card overlapping messages, clipped buttons, horizontal overflow at 390, dark text on dark, cards on safe chats. Also run `grep -rniE "guarantee|you are protected|100% safe|facebook|messenger|meta" pilot/extension --include=*.html --include=*.css` and make sure user-visible copy has no social-network names (manifest match URLs and adapter comments are fine).

Finish with a short summary: files written, the exact pass/fail lines of both test runs, screenshot paths, anything you could not do, and which selectors are guesses that need a live check.
