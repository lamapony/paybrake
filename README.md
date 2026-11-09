# PayBrake

**Brakes before you pay.** PayBrake is a Chrome extension that flags risky payment requests in marketplace chats and offers a safer PayPal Goods & Services checkout (sandbox) instead.

**Demo:** https://paybrake-demo.spbabinov.workers.dev/ (about 2 minutes, nothing to run locally)

![A PayBrake card under a seller's request for a Friends & Family deposit](shots/ext-live-1280.png)

Fictional names only. Not affiliated with PayPal or any marketplace. No real money moves in this build: PayPal runs in sandbox or on a mock, and live PayPal is refused in code.

Built for the PayPal AI Hackathon on Devpost.

## What it does

Marketplace scams tend to end the same way. The "seller" pushes the buyer off the protected path: PayPal Friends & Family, a bank transfer, a gift card, crypto, or a deposit on an item the buyer has not seen.

PayBrake reads the open chat, and when it finds that kind of request it draws a card under the message. The card names the risk and quotes the line that triggered it. **Switch to a PayPal order** creates a PayPal Orders v2 order for the item and price in the chat, so the buyer can approve and capture it as Goods & Services in the sandbox. **Pay anyway** steps aside and notes the override on the device only. Ordinary chats get no card.

Buyer Protection copy says **may be eligible** and points at PayPal's terms. The UI does not promise coverage.

## How it works

Three layers decide whether a card appears. The first two run inside the extension.

1. **On-device rules** (`extension/lib/atoms.js`, `pay-risk.js`). English and Danish patterns find a payment ask in the other person's lines. The user's own lines never raise a signal. A rules hit sets the risk level.
2. **On-device model** (`extension/lib/scam-model.js`, on by default). Hashed word and character n-grams feed a logistic regression with int8 weights, trained only on synthetic chats. It needs no network and no download. It covers chats where the rules find no payment ask yet (a new-number "hej mor", prize bait) and adds a **medium** card at most. It never raises a rules card and never overrides a checkout veto.
3. **Optional server AI check** (`/api/classify`, Typesafe model `jev-1.14.0`, on in this demo build). The extension masks emails, phone numbers, card numbers, IBANs and codes first. The AI can confirm a rules card, lower it, or clear it at high confidence, and it can add a card where the rules are silent. It can **never raise the level of a rules card**, and a quote that is not in the message is ignored.

If the server is down or rate-limited, the rules and the model keep working. The card still appears; only creating an order needs the backend.

```
 Chrome extension (MV3), on your device          Cloudflare Worker (hosted) or Node backend (local)
 ┌───────────────────────────────────────┐      ┌───────────────────────────────────────────────┐
 │ content.js   reads the open chat,     │      │ /api/classify   optional AI check             │
 │              draws the card           │ AI   │   Typesafe, key server-side only              │
 │ rules        atoms.js, pay-risk.js    │ ───> │   confirm, lower, clear, or add a card        │
 │ model        scam-model.js + weights  │      │   never raises a rules level                  │
 │              medium card, no network  │      │   capped per IP and per day, kill switch      │
 │ background   cache, override log      │order │ /api/protect, /api/orders/:id/capture         │
 │              (device only)            │ ───> │   PayPal Orders v2 sandbox, or mock orders    │
 └───────────────────────────────────────┘      └───────────────────────────────────────────────┘
```

Stack: PayPal Orders v2 (sandbox, plus a no-credentials mock), the PayPal Agent Toolkit tool names, Chrome Manifest V3, Node 20, Cloudflare Workers.

## Try the hosted demo

1. Download **[paybrake-extension.zip](https://paybrake-demo.spbabinov.workers.dev/paybrake-extension.zip)** and unzip it.
2. In Chrome (or Edge, or Brave), open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, and pick the `paybrake-extension` folder (the one with `manifest.json` in it).
3. Open the **[demo store](https://paybrake-demo.spbabinov.workers.dev/demo/marketplace.html?live=1)**. A **High risk** card appears under the bike seller's message.
4. Click **Switch to a PayPal order**, then **Open approval**, then **Approve (mock)**. Back in the chat, click **I approved it, capture**.

The desk lamp chat on the same page stays silent. The full walkthrough, with what to do if Chrome complains, is in [TESTING.md](TESTING.md).

## Run it locally

Node 20 or newer, from a clean clone:

```sh
npm install
cp backend/.env.example backend/.env
npm run dev:backend
```

In a second terminal:

```sh
npm run serve:demo
```

Then load the `extension/` folder with **Load unpacked**, open the extension's options, click **Use localhost:8787**, save, and open `http://localhost:8080/demo/marketplace.html?live=1`. With no PayPal credentials, orders are `MOCK-` orders. To use the PayPal sandbox or turn on the AI check locally, see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Measured results

Every number here comes from a command run on 9 Nov 2026 against commit `2517017` (rules version 5, model `lr-h18-f1-2026-11-05`, threshold 0.922). The sets measure different things, so please do not add them together.

`npm test` (offline): 379 tests, 378 pass, 0 fail, 1 skipped. The skipped test is a browser pass that needs `CHROME_PATH`.

| Set | Command | System | Scams caught | False alarms |
|---|---|---|---:|---:|
| In-repo marketplace chats (39 chats, written by us) | `npm run eval` | rules | 18 of 18 | 0 of 21 |
| Same 39 chats | `npm run rescore:model` | model alone | 5 of 18 | 0 of 21 |
| Same 39 chats | `npm run rescore:model` | rules + model | 18 of 18 | 0 of 21 |
| Held-out synthetic chats (100; 65 Danish, 35 English) | `node research/chat-scams/train-model.mjs --no-write` | rules | 21 of 40 | 3 of 60 |
| Same 100 chats | same | rules + model | 35 of 40 | 3 of 60 |
| Public datasets, test split (1,573 messages) | same | rules | 325 of 713 | 9 of 860 |
| Same 1,573 messages | `npm run eval:real:model` | rules + model | 362 of 713 | 11 of 860 |

How to read this:

- The 39-chat set is a regression gate we wrote ourselves. Passing it means nothing broke. It is not a field accuracy number.
- The model is a second layer. On its own it catches only 5 of the 18 marketplace payment scams.
- The public-dataset row is the hard one: about half of those scams are caught, mostly because SMS and Discord spam rarely asks for a payment in the chat. Most of the model's gain there comes from the two synthetic datasets. Real SMS and real Discord barely move.
- Nothing here has been measured on real marketplace chats.

Per-dataset numbers and method: [docs/EVALUATION.md](docs/EVALUATION.md).

## Limits

- Patterns cover English and Danish. Wording outside the list stays silent on purpose.
- The demo adapter reads our own demo pages (`data-pb-*`). There are no adapters for real marketplaces.
- The model is linear and trained on synthetic chats. It adds only medium cards, only where the rules found no ask.
- Mock orders are kept 24 hours in a Durable Object on the hosted Worker (in memory on the local backend).

## Docs

- [TESTING.md](TESTING.md): step-by-step demo walkthrough for testers and judges
- [CONTRIBUTING.md](CONTRIBUTING.md): tests, branches, no secrets
- [docs/README.md](docs/README.md): index of everything else, including the backend contract, the evaluation, the backlog and the design decisions
- [SPEC.md](SPEC.md): the original product spec

## Team

- Dmitrii Babinov ([@lamapony](https://github.com/lamapony)): hosted demo, extension, README
- Christopher Wang ([@christopherwang0129SE](https://github.com/christopherwang0129SE)): PayPal backend
- David ([@David-Dashboard](https://github.com/David-Dashboard)): AI model

## License

[MIT](LICENSE) © 2026 Dmitrii Babinov and Christopher Wang
