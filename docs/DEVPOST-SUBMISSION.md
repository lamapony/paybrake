# PayBrake: Devpost submission text

Copy-paste source for the Devpost form. Every claim below points at code on this branch. Numbers are dated. If you change the detector after the freeze, re-run `npm test` and `npm run eval` and update the **Checks** line before pasting.

Deadlines (Copenhagen time): main freezes **5 Nov 12:00**, Devpost early submission **5 Nov 21:00**, final **12 Nov 21:00** (SPEC.md: 12 Nov 12:00 PT).

> **Repository visibility.** SPEC.md says the hackathon asks for a public repo with an OSS licence, and TESTING.md notes the issue form only works once it is public. On 4 Nov `lamapony/paybrake` was **private**. A search for `christopherwang0129SE/paybrake` found nothing: no public repo by that name, and this session can't see private ones. Before submitting, decide which repo goes in the Devpost "Try it out" links, make it public, and run the **Before going public** checklist in [SUBMISSION-GAPS.md](SUBMISSION-GAPS.md) first (`pilot/` and `PILOT-TASK.md` are still in the tree).

---

## Project name

PayBrake

## Tagline (max 200 chars)

Brakes before you pay: a Chrome extension that spots scam payment asks in marketplace chats and offers a PayPal Goods & Services order instead.

## Inspiration

Most marketplace scams end the same way. The "seller" (or a fake buyer) moves the payment off the protected path: PayPal Friends & Family, a bank transfer, MobilePay to a phone number, a gift card, crypto, or a deposit "to hold it" for an item nobody has seen. The scam isn't in the listing. It's one sentence in the chat, and that sentence is the last moment anyone can step in. In Denmark, where we started, secondhand selling runs on chat plus MobilePay or PayPal, so we built for English and Danish wording from day one.

## What it does

- **Reads the chat on the device.** On our demo marketplace, the extension reads the other person's messages and runs English and Danish rules locally (`extension/lib/atoms.js`, `extension/lib/pay-risk.js`). It flags concrete payment-risk signals: Friends & Family (including "send it as a gift", "PayPal FF", "F&F only"), upfront deposits and "hold it for you" fees, off-platform rails (bank transfer and IBAN, MobilePay, Revolut, Wise, Western Union, Venmo, Zelle, Cash App, Swish, Vipps, Apple Pay, Klarna, Skrill, gift and store cards, crypto), pay-before-you-see, card or code requests, remote-access apps, fee-to-release links, and the overpay-and-refund trick.
- **Explains itself.** The card says **High risk payment request** or **Possible payment risk**. It lists the signals and quotes the exact risky line from the message. A card can't open without a matched span (ADR 0001, "silent unless evidenced").
- **Stays quiet on normal chats.** Cash or MobilePay at pickup, the marketplace checkout, Goods & Services the seller offered, advice like "never send a deposit via F&F", and a buyer's own lines don't raise a card.
- **AI check (on by default in the demo build).** The chat is masked first (`extension/lib/redact.js`: emails, phones, card numbers, IBANs, ID numbers and codes) and sent to `/api/classify`. On the hosted demo that runs Typesafe model `jev-1.14.0`, with the key held server-side. The AI can confirm a rules card or lower its level, or add a card when the rules are silent and it quotes the other person verbatim. It can never raise a rules level, and a quote not found in the chat is ignored (`clampLevel`, `combineAll` in `pay-risk.js`). If the AI is down or rate-limited, the rules verdict stands.
- **Offers the safe path.** **Switch to a PayPal order** creates a PayPal Orders v2 order (`intent: CAPTURE`) for the item and price in the chat. The flow is **Open approval** → approve → **I approved it, capture** → **Paid with PayPal Goods & Services (sandbox)**. It runs on the PayPal sandbox when keys are set and a `MOCK-` order otherwise. Live PayPal is refused in code (`PAYPAL_ENV` must be `sandbox`).
- **The user still decides.** **Pay anyway** writes a local log only ("You chose to pay anyway. Logged on this device."). Buyer Protection copy says *may be eligible* and points at PayPal's terms.

## How we built it

- **Extension:** Chrome Manifest V3 with plain classic scripts and no bundler. A content script reads `data-pb-*` threads on our own demo pages and draws the card in a shadow root. `background.js` caches verdicts per chat hash and rules version, keeps the override log (max 200 entries), and talks to the backend. Permissions are `storage` plus our demo and localhost hosts only.
- **Detector:** about 170 regex "atoms", each with a gate (pay word nearby, parsed amount, negation, handover, prohibition). One strong atom plus money or a pay word is medium. Two strong atoms, or one strong plus a weak one (urgency, "I ship tomorrow"), is high. Vetoes (checkout, agreed Goods & Services, pay at pickup) hide the card. Amount parsing handles `500 kr`, `DKK 1.800`, `1,800 kr`, `€45` and `$120` (`extension/lib/extract.js`).
- **Backend:** Node 20 with no framework (`backend/src/server.js`). It uses an `OrdersPort` with `mock`, `rest` (PayPal Orders v2 sandbox with OAuth token cache, `PayPal-Request-Id`, `payer-action` link) and `toolkit` adapters. The toolkit adapter uses the PayPal Agent Toolkit tool names `create_order`, `get_order` and `pay_order`, executed through rest, because the published toolkit has no payee field and is USD-only. `/api/classify` supports Typesafe, OpenRouter or any OpenAI-compatible provider.
- **Hosted demo:** one Cloudflare Worker (`hosted/`) serves the demo store, the extension zip, the order API (mock orders live in a Durable Object for 24 hours) and the AI check. The AI check is capped at 2000 characters, 20/min and 150/day per IP, and 2000/day globally, and has a kill switch (`AI_KILL_SWITCH`).
- **Evaluation:** a 35-chat synthetic regression set (`npm run eval`, gate: precision ≥ 0.95, recall ≥ 0.80, zero false alarms). There is also a harness on four public Hugging Face scam and legit datasets (`eval/real/`). It commits only IDs, labels and predictions, not message text.
- **Tests:** `npm test` runs the offline suite: detector, extraction, redaction, card rendering, copy rule, secrets grep, and backend adapters with mocked fetch. Playwright drives a browser flow and an extension smoke test (`npm run e2e`).

## Challenges we ran into

- **The same words are both the scam and the advice.** "Never send a deposit via Friends & Family" contains every word of the scam. We built a prohibition layer that covers the object of "never send / send ikke / lad være med at" up to the next clause break, and another layer for refusals answered in a question ("Payment first? No, …").
- **Normal Danish payments look like scam rails.** "Betal med MobilePay ved afhentning" is how half of Denmark pays for a used bike. We tie the payment to the handover so it stays quiet, unless the same clause says now, first, or deposit.
- **Scammers name the safe path to dodge it.** "G&S fees are too high, send it F&F" mentions Goods & Services. We only treat G&S as agreed when the seller isn't steering away from it.
- **Letting an AI help without letting it hallucinate a warning.** The AI must quote the other person verbatim, can only lower a rules level, and can add a card only above a confidence bar. A timeout falls back to rules.
- **Privacy.** Nothing leaves the browser for rules-only. For the AI check, numbers, emails, IBANs and codes are masked first.

## Accomplishments that we're proud of

- An end-to-end path a judge can run in about two minutes with nothing installed but the unzipped extension: risky chat → explained card → PayPal order → approve → capture.
- On the 35-case synthetic regression set: precision 1, recall 1, zero false alarms. That set is our own writing, so we treat it as a regression gate, not a field accuracy number.
- On public third-party data (rules v4, 3 Nov, test split of 1,573 messages): precision 0.976 and a false-alarm rate of 0.9%. Recall was 0.456 overall, because most SMS and Discord spam never asks for a payment. On ScamGuardBench's money-asking scams the rules caught 53 of 55. Details and caveats are in `eval/real/RESULTS.md`. These datasets are not marketplace chats.
- A pre-freeze bug hunt (5 Nov) fixed 15 detection false positives and false negatives, each with a test. Four independent adversarial reviews then compared about 1,500 inputs against the previous build, and every regression they found is now a test. Examples: MobilePay at pickup no longer warns, and a buyer asking "Can I pay through checkout?" no longer hides the seller's F&F demand.

## What we learned

- Precision is the product. A card that cries wolf on "MobilePay when you pick it up" teaches people to ignore it, so every new rule ships with quiet cases next to the risky ones.
- Who said it matters as much as what was said. The buyer's own line must never raise a card, and must never hide one either.
- Clause-level reasoning (negation, prohibition, handover, contrast words like "but") does most of the work, and it beats adding more keywords.
- An AI is most useful as a second opinion with hard limits: it can lower or confirm, quote or be ignored, and the rules still run when it times out.

## What's next

- Adapters for real marketplace chat UIs. Today there is one adapter for our own demo pages. Real sites need per-site selectors and a privacy review before shipping.
- More languages (Swedish and Norwegian beyond rail names, German) and NOK/SEK amounts. PR #35 adds them but needs a fix: Danish "nok" means "probably".
- Re-measure rules v5 on `eval/real` and publish the per-row predictions. Collect a consented, labelled set of real marketplace chats.
- An opt-in learned scorer (TF-IDF + logistic regression, draft PR #45) next to the rules, behind a flag, evaluated with grouped cross-validation.
- A seller mode for fake-buyer scams ("I paid you, now pay the courier fee").

## Built with

`javascript` · `chrome-extension` (Manifest V3) · `node.js` (20+) · `paypal` Orders v2 REST API (sandbox) · PayPal Agent Toolkit tool names (`create_order`, `get_order`, `pay_order`) · `typesafe` AI (`jev-1.14.0`) · `openrouter` (optional provider) · `cloudflare-workers` · Cloudflare Durable Objects · `playwright` · `node:test` · Hugging Face datasets (evaluation only)

## Try it out links

- Hosted demo: https://paybrake-demo.spbabinov.workers.dev/
- Extension zip: https://paybrake-demo.spbabinov.workers.dev/paybrake-extension.zip
- Repo: (the public repo you choose, see the visibility note at the top)
- Video: (add after recording)

---

## Demo video shot list (under 3 minutes)

Rules from SPEC.md: under 3 minutes, our own fictional demo pages only (no real social network or marketplace), no personal data, no credentials on screen. Record the hosted demo with the extension loaded from the zip. Use 1280×800 or larger, and zoom the browser to 125% so the card text is readable.

| # | Time | Shot | On screen (exact labels) | Narration (suggested) |
|---|---|---|---|---|
| 1 | 0:00–0:12 | Title card | "PayBrake: brakes before you pay" + logo | "Most marketplace scams end with one sentence in the chat: pay me another way." |
| 2 | 0:12–0:30 | Demo store, bike thread, no card yet | Seller Jonas: "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow…" | "Here a seller asks for a Friends & Family deposit for a bike the buyer hasn't seen." |
| 3 | 0:30–0:55 | Card appears; hover the chips | **High risk payment request**, signals Friends & Family · Upfront deposit · Pressure to hurry · Ships before you meet, quoted line, then the **AI checked** tag | "PayBrake reads the chat on the device, names the risky ask, and quotes it. An AI check then confirms it. The AI can lower a warning but never raise one." |
| 4 | 0:55–1:25 | Click **Switch to a PayPal order** → **Open approval** → **Approve (mock)** (or the PayPal sandbox page if `/health` says `"paypal": "rest"`) → back → **I approved it, capture** | "Sandbox order created · ID …", "Marked approved", "Paid with PayPal Goods & Services (sandbox)" | "One click turns the risky ask into a PayPal order for the same item and price. Approve, capture, done. This is the sandbox, no real money." |
| 5 | 1:25–1:45 | **Signe Kruse · camera** thread → **Pay anyway** | "You chose to pay anyway. Logged on this device." | "The user stays in control. Pay anyway is allowed and only logged locally." |
| 6 | 1:45–2:05 | Scroll to the desk-lamp thread, then `demo/safe-chats.html` | No card | "Normal chats stay quiet: cash or MobilePay at pickup, the marketplace checkout, Goods & Services." |
| 7 | 2:05–2:25 | Extension options page | "Ask the backend for an AI check", the masking paragraph, the override log | "Before anything goes to the AI, emails, phone numbers, IBANs and codes are masked. Rules-only mode sends nothing." |
| 8 | 2:25–2:45 | Terminal: `npm test` and `npm run eval` passing | test count, "precision 1 recall 1 … false alarms 0" | "Every rule ships with quiet cases. 35 synthetic chats plus public scam datasets keep it honest." |
| 9 | 2:45–2:55 | Closing card | Hosted demo URL, team names | "PayBrake. Brakes before you pay. Try it at the link below." |

Before recording, check:
- `/health` on the hosted Worker: `"llm": "configured"` (otherwise the card says **AI check off (mock server)**, so cut "AI checked" from the narration) and `"paypal": "mock"` or `"rest"`.
- The hosted zip is rebuilt from the frozen main (`npm run hosted:deploy`), so the card matches this code and rules v5.
- A fresh Chrome profile, so there are no cached verdicts or other extensions in shot.

## Judge test instructions (paste into Devpost "Testing instructions")

**About 2 minutes. You need Chrome, Edge or Brave. Nothing else to install, no account, no real money.**

1. Open https://paybrake-demo.spbabinov.workers.dev/ and download **paybrake-extension.zip**. Unzip it.
2. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the **paybrake-extension** folder (the one that contains `manifest.json`). A **Welcome to PayBrake** tab opens.
3. Click **Try the demo store** (or open https://paybrake-demo.spbabinov.workers.dev/demo/marketplace.html?live=1). In the bike chat a card appears: **High risk payment request**, quoting the seller's Friends & Family deposit ask. After a second or two it is tagged **AI checked**.
4. Click **Switch to a PayPal order**, then **Open approval**, then **Approve (mock)**. Go back to the chat tab and click **I approved it, capture**. The card shows **Paid with PayPal Goods & Services (sandbox)**.
5. Optional: open the **Signe Kruse · camera** chat and click **Pay anyway**. It is allowed and logged on your device only. The desk-lamp chat is normal and stays quiet.

If you see a yellow **PayBrake is not running in this browser** box, the extension isn't loaded. Repeat step 2 and reload the page.

**Run it locally instead (Node 20+):** `npm install`, `cp backend/.env.example backend/.env`, `npm run dev:backend`, and in a second terminal `npm run serve:demo`. Load `extension/` unpacked, click **Use localhost:8787** in its options, then open `http://localhost:8080/demo/marketplace.html?live=1`. Offline checks: `npm test` and `npm run eval`.

**Limits we are upfront about:** English and Danish wording only. One adapter, for our own demo pages, not real marketplaces. Rules can miss new wording. The AI check is capped per IP and per day on the hosted demo, and the rules keep working when the cap is hit.

---

## Checks behind this text (branch `claude/pb-prefreeze-1105-lr6yf8`)

- 7 Nov, after merging main and the issue #21/#22 fixes: `npm test` 342 tests, 341 pass, 0 fail, 1 skipped (the browser flow test, `CHROME_PATH` unset), Node 24 locally; CI runs Node 20 and 24.
- 5 Nov (earlier head): 334 pass, 0 fail with `CHROME_PATH` unset, on Node 20 and Node 22. With `CHROME_PATH` set, the browser flow test also passed. `npm run e2e` (extension smoke) passed then; it was not re-run on the 7 Nov head.
- `npm run eval`: precision 1, recall 1, f1 1, false alarms 0 (tp 18, fp 0, fn 0, tn 17).
- `eval/real` was **not** re-run for rules v5, because Hugging Face is not reachable from the environment that made these fixes. The v4 numbers above are from `eval/real/RESULTS.md` (3 Nov).
- `npm run e2e:hosted` was not run. The hosted Worker was not redeployed from this branch.
