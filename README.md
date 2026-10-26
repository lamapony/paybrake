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

Options (right-click the toolbar icon, or open the extension's options page): backend URL (default `http://localhost:8787`), rules-only vs an AI check, a debug HUD, and the on-device override log (download JSON or clear).

## What the pieces do

```
demo page (data-pb-* threads)
        |
        v
content.js  ----messages---->  background.js
 shadow card                     cache by hash + rules version
 never clicks the site           override ring log (max 200)
        ^                          |
        |                          v
        +-------- JSON --------  server.js   :8787
                                 OrdersPort
                                   mock   (this build, no credentials)
                                   rest   (not implemented)
                                   toolkit (not implemented)
                                 /api/classify -> 503 llm_off until LLM_BASE_URL is set
```

Detection runs in the extension from regex atoms (English and Danish). The backend is only for orders and, later, the model. With the AI check left off, a stopped backend still shows the card. Protect then shows one line: the helper could not be reached.

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

Rules eval on 30 synthetic chats (16 risky, 14 safe, fictional names): precision 1, recall 1, F1 1, false alarms 0. The run exits 1 if precision is under 0.95, recall is under 0.80, or any safe case fires. Live eval exits 0 with a skip message unless `/health` reports the model configured.

Screenshots: `npm run shots`. Extension smoke: `npm run e2e` (Chromium with the unpacked extension). If the browser cannot load an extension in this environment, that script prints `SKIP` and exits 0.

## Limits

- Atoms are English and Danish only. Wording outside the list stays silent on purpose.
- The model can confirm or lower a hit. It cannot raise one, and a quote that is not in the message is ignored.
- Orders live in memory on one Node process.
- One demo adapter (`data-pb-*` on our own pages). No adapters for real marketplaces.
- Buyer Protection copy says **may be eligible**, and points at PayPal's terms. The UI does not claim a payment is certain or covered.

## License

MIT © 2026 Dmitrii Babinov and Christopher Wang
