# PayBrake

**Brakes before you pay.** A Chrome extension that reads a marketplace chat on your device, stays quiet unless a payment ask has a concrete span of evidence, and can open a PayPal sandbox order for the listed item instead of a blind transfer.

Fictional names only. Not affiliated with PayPal or any marketplace. No real money moves in this build.

## Run in 5 minutes

From a clean clone, Node 20:

```sh
npm install
cp backend/.env.example backend/.env
npm run dev:backend
```

In a second terminal:

```sh
npm run serve:demo
```

Then:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Load unpacked and choose the `extension/` folder.
4. Open `http://localhost:8080/demo/marketplace.html?live=1`.

The static card is hidden. The extension draws its own card in the bike thread. **Move to protected PayPal order** creates a `MOCK-` sandbox order with no PayPal credentials. **Open approval** goes to a mock page. **Approve (mock)**, return to the chat, then **I approved it, capture**.

`Signe Kruse · camera` is a second risky thread for **Pay anyway**. `demo/safe-chats.html` should stay silent.

`Lars Møller · speaker` is an overpay-and-refund plus a shipping-label fee. The lamp thread should stay silent.

Options (right-click the toolbar icon, or open the extension's options page): backend URL (default `http://localhost:8787`), the browser judge, a backend AI check used only when the browser has no model, a debug HUD, and the on-device override log (download JSON or clear).

## What the pieces do

```
demo page (data-pb-* threads)
        |
        v
content.js  ----messages---->  background.js
 shadow card                     rules first, then the browser judge
 never clicks the site           cache by hash + rules version
        ^                        override ring log (max 200)
        |                          |
        |                          +---- LanguageModel (on-device, if Chrome has it)
        |                          |
        +-------- JSON --------  server.js   :8787
                                 OrdersPort
                                   mock   (this build, no credentials)
                                   rest   (not implemented)
                                   toolkit (not implemented)
                                 /api/classify -> only if the browser judge is off
                                                  and the backend AI check is on
```

Detection runs in the extension from regex atoms (English and Danish). The card stays hidden until an atom matches a span. The backend is for orders. A stopped backend still shows the card. Protect then shows one line: the helper could not be reached.

## Browser judge

The judge is a small task so a tiny on-device model can do it. Rules decide that a payment ask is risky. The model only confirms, lowers, or rejects that hit, and it must quote a span that is already in the message. It cannot open a card the rules did not open, and it cannot raise the level.

The prompt is capped at 900 characters. The reply is one JSON object:

```json
{"v":"confirm|lower|reject","lv":"high|medium|none","q":"verbatim quote","why":"ff_deposit|ff|deposit_off|before|off|deposit|overpay|label_fee|generic"}
```

`why` picks a fixed sentence. The model does not write the card copy.

Chrome's Prompt API (`LanguageModel`, the on-device Gemini Nano) is the runtime. It runs in the extension service worker when `LanguageModel.availability()` is `available`. A missing model, a model that still needs a download, or a timeout leaves the rules result and the footer says `rules check`. A confirmed hit says `browser judge`. No chat text leaves the browser for that check.

The same prompt is the contract for a later tiny model. Swap `browserGenerate` in `extension/lib/tiny-judge.js`. Do not send the model an open "is this a scam?" question.

## Mock and sandbox

| | Mock (this repo) | Sandbox (next) |
|---|---|---|
| When | `PAYPAL_CLIENT_ID` empty | client id and secret set, adapter `rest` |
| Order id | `MOCK-<uuid>` | PayPal order id |
| Approval | `demo/checkout-return.html` button | PayPal sandbox checkout |
| Money | none | sandbox only |

`PAYPAL_ENV` must be `sandbox`. The process refuses to start otherwise, including `live`. `rest` and `toolkit` throw `not implemented yet: see docs/BACKEND-CONTRACT.md` until Christopher lands them. See that file for routes, JSON, and the OrdersPort.

## Checks

Offline:

```sh
npm test
npm run eval
```

Rules eval on the synthetic chats in `eval/cases/pay-risk.json` (fictional names). The run exits 1 if precision is under 0.95, recall is under 0.80, or any safe case fires. Those scores are a regression check on that file, not field accuracy. Live eval exits 0 with a skip message unless `/health` reports the model configured.

Screenshots: `npm run shots`. Extension smoke: `npm run e2e` (Chromium with the unpacked extension). If the browser cannot load an extension in this environment, that script prints `SKIP` and exits 0.

## Limits

- Atoms are English and Danish only. Wording outside the list stays silent on purpose.
- The model can confirm or lower a hit. It cannot raise one, and a quote that is not in the message is ignored.
- Orders live in memory on one Node process.
- One demo adapter (`data-pb-*` on our own pages). No adapters for real marketplaces.
- Buyer Protection copy says **may be eligible**, and points at PayPal's terms. The UI does not claim a payment is certain or covered.

## License

MIT © 2026 Dmitrii Babinov and Christopher Wang
