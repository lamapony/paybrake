# Operating PayBrake

How the hosted demo and the local backend are configured. For a first run, start with the [README](../README.md) or [TESTING.md](../TESTING.md). The API shape is in [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md).

## The hosted Worker

The hosted server is one Cloudflare Worker (free plan): the demo store pages, the PayPal order backend (PayPal sandbox when the `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` Worker secrets are set, otherwise mock orders kept 24 hours; `/health` shows `"paypal": "rest"` or `"mock"`; optional `PAYPAL_PAYEE_EMAIL` = your sandbox Business account), and `/api/classify`, the AI check. The Typesafe key lives only in the Worker as a secret; the extension never sees it.

### Hosted demo limits

The AI check spends a real API key, so `/api/classify` on the hosted Worker is capped (see `hosted/src/index.js`):

| Limit | Value | When hit |
|---|---|---|
| Input length | 2000 characters (the extension sends the latest 1900) | 413 `text_too_long`, no model call |
| Per IP, per minute | 20 (strict, Durable Object) and 30 (Cloudflare rate-limit binding) | 429 `rate_limited`, `Retry-After: 60` |
| Per IP, per day | 150 | 429 `busy` |
| All visitors, per day (UTC) | 2000 | 429 `busy` |
| Request body | 16 KB | 413 |
| Kill switch | `AI_KILL_SWITCH=1` (Worker secret or var) | AI off at once: `/health` says `"llm": "off"`, `/api/classify` 503 `llm_off` |

On any non-200 the extension falls back to its on-device rules, so the demo keeps working with the AI off. `GET /health` shows the active limits and the kill switch state. Optional vars `AI_PER_IP_PER_MINUTE`, `AI_PER_IP_PER_DAY`, `AI_PER_DAY` change the caps, up to hard maxima of 60, 1000 and 20000.

Kill switch: `cd hosted && npx wrangler secret put AI_KILL_SWITCH` (enter `1`). Turn it back on with `npx wrangler secret delete AI_KILL_SWITCH`. No redeploy needed.

Deploy: `npm run hosted:deploy` (builds the extension zip and the pages into `hosted/public/`, then `wrangler deploy`; wrangler 4 itself needs Node 22+). Set the key once with `npx wrangler secret put TYPESAFE_API_KEY`. Never commit it.

## Extension options

Options (right-click the toolbar icon, or open the extension's options page): backend URL (default: the hosted mock server `https://paybrake-demo.spbabinov.workers.dev`; one click switches to `http://localhost:8787`), rules-only vs an AI check, a debug HUD, and the on-device override log (download JSON or clear).

## Mock and sandbox

| | Mock | Sandbox |
|---|---|---|
| When | `PAYPAL_CLIENT_ID` empty, or `PAYPAL_ADAPTER=mock` | client id and secret set, adapter `rest` or empty |
| Order id | `MOCK-<uuid>` | PayPal order id |
| Approval | `demo/checkout-return.html` button | PayPal sandbox page (`payer-action` link, else `approve`) |
| Money | none | sandbox only |

`PAYPAL_ENV` must be `sandbox`. The process refuses to start otherwise, including `live`. `PAYPAL_BASE_URL` must be `https://api-m.sandbox.paypal.com` (the default when the variable is empty) or `https://api.sandbox.paypal.com`. Any other host is refused.

With an empty client id, `PAYPAL_ADAPTER=rest` still selects mock. `/health` then shows `"paypal": "mock"`.

### PayPal Agent Toolkit: what we found (SPEC §5)

Published `@paypal/agent-toolkit` 1.11.0: `create_order` has no payee field, and `currencyCode` is USD only. The package also pulls in `ai`, `openai`, `langchain`, `axios`, and the PayPal server SDK. This repo does not install it.

`backend/src/paypal-toolkit.js` is a stub with the tool names `create_order`, `get_order`, and `pay_order`. Each call runs through the rest adapter, which sends `payee.email_address` and accepts DKK, EUR, and USD. `PAYPAL_ADAPTER=toolkit` needs the same client id and secret as rest. `backend/src/agent.js` fills `create_order` from the validated deal and calls `runTool`. There is no model tool loop.

## Switch from mock to PayPal sandbox

1. Log in at [developer.paypal.com](https://developer.paypal.com) with a PayPal account. Open **Apps & Credentials**, set the toggle to **Sandbox**, and choose **Create App** with type **Merchant**. Copy the Client ID and the Secret. Keep both out of git.

2. Open **Testing Tools → Sandbox Accounts**. Use or create one **Business** account (the seller; its email is the payee) and one **Personal** account (the buyer; this is the login on the approval page).

3. Run `cp backend/.env.example backend/.env`. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Leave `PAYPAL_ENV=sandbox` and `PAYPAL_ADAPTER=rest`. `backend/.env` is gitignored. Never commit it.

4. Run `npm run dev:backend`. Open `http://127.0.0.1:8787/health`. `paypal` is `"rest"`. If the client id is set and the secret is empty, the process exits with `PAYPAL_CLIENT_SECRET is required for the rest adapter`. An empty client id leaves `paypal` as `"mock"`.

5. On the demo page, press **Switch to a PayPal order**. **Open approval** opens the PayPal sandbox page. Log in as the sandbox Personal buyer, approve, and the browser returns to the demo return page (the **Approve (mock)** button stays hidden). Go back to the chat and press **I approved it, capture**.

The payee has to be that Business account's email, or PayPal rejects the order. The bike messages contain no email address, so the extension sends `data-pb-seller-email` from the thread. In `demo/marketplace.html`, on the section `#thread-bike`, change `data-pb-seller-email` from `jonas.holm@example.com` to the sandbox Business email before you click protect. The card field **Seller email for this order** (`#pb-email` in `extension/content.js`) is shown only when that value is missing, so this thread does not show it. For the camera thread, edit the same attribute on `#thread-camera` (currently `signe.kruse@example.com`). An email written in a message wins over the attribute (`extension/lib/extract.js`).

The bike price is DKK. Rest accepts DKK, EUR, and USD.

## Turn on the AI check

Typesafe (what the hosted demo uses): in `backend/.env`, set `LLM_PROVIDER=typesafe` and `TYPESAFE_API_KEY`. OpenRouter: set `LLM_PROVIDER=openrouter` and set `OPENROUTER_API_KEY` to your OpenRouter key. Restart the backend. `/health` shows `"llm": "configured"` and `"llmProvider": "openrouter"`. A key with `LLM_PROVIDER` and `LLM_BASE_URL` both empty selects openrouter the same way, even when a Typesafe key is also set. Typesafe is selected in that empty case only when its key is set and the OpenRouter key is not. `LLM_FALLBACK=openrouter` sends the chat to OpenRouter after a Typesafe failure other than a 4xx. `TYPESAFE_API_KEY_NAME` is used only when the name starts with `TYPESAFE_`. If `LLM_BASE_URL` is set, that empty provider means openai-compatible instead. Any other `LLM_PROVIDER` value stops the process at startup (`Unknown LLM_PROVIDER`). With `LLM_PROVIDER=openrouter`, `LLM_BASE_URL` is used only when it is https on `openrouter.ai`; any other host is ignored, so the key is not sent there. In the extension options, turn on **Ask the backend for an AI check (off uses rules only)** and save. The model can confirm a rules hit or lower it. It cannot raise one. A quote that is not in the message is ignored.
