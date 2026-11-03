# Christopher handoff

Branch `backend-rest`. The sandbox rest adapter, the toolkit stub, and OpenRouter classify are in the tree and covered by offline tests. No call to PayPal or to a model has been made from this repo.

## What is done

- `backend/src/paypal-rest.js` — sandbox Orders v2. OAuth client-credentials token, cached until `expires_in - 60` seconds. Create, get, and capture. Payee email, DKK/EUR/USD, `PayPal-Request-Id`, approve link `payer-action` then `approve`. PayPal errors map to 400, 404, 409, and 502.
- `backend/src/paypal.js` — empty client id still selects mock. `rest` and an empty adapter use rest. `toolkit` uses the stub. `PAYPAL_ENV` must be `sandbox`. A live base URL is refused.
- `backend/src/paypal-toolkit.js` — tool names `create_order`, `get_order`, `pay_order`. They run through rest. `@paypal/agent-toolkit` is not installed.
- `backend/src/agent.js` — in toolkit mode, protect calls `runTool("create_order")` with the validated deal. No model tool loop.
- `backend/src/classify.js` — `resolveLlm` selects `openrouter`, `openai-compatible`, or off. Evidence must be a substring of the chat. Reasons that match the banned-phrase check are dropped.
- `backend/src/server.js` — wires the ports. `/health` adds `llmProvider`. 502 codes are `paypal_error`, `paypal_auth`, and `llm_error`. `GET /return` approves only in mock mode.
- `backend/test/paypal-rest.test.mjs`, `backend/test/paypal-toolkit.test.mjs`, `backend/test/classify-provider.test.mjs`, plus the rest cases in `backend/test/paypal.test.mjs` and `backend/test/server.test.mjs`. Fetch is mocked.
- `demo/checkout-return.html` — **Approve (mock)** is hidden unless the URL has `mock=1`.
- `backend/.env.example` — every variable the server reads, with empty secrets. `docs/BACKEND-CONTRACT.md` is the route and error list.

## How to check it in 2 minutes

From the repo root, Node 20:

```sh
npm install
npm test
npm run eval
```

`npm test` passes 253 tests. All of them are offline. `npm run eval` is rules mode on 35 chats: precision 1, recall 1, false alarms 0. You do not need a PayPal app or an API key for either command.

## What you still need to do

### (a) Sandbox app and two sandbox accounts

1. Log in at [developer.paypal.com](https://developer.paypal.com) with a PayPal account.
2. **Apps & Credentials**. Toggle **Sandbox** (leave Live alone). **Create App**, type **Merchant**. Copy the Client ID and the Secret.
3. **Testing Tools → Sandbox Accounts**. Use or create one **Business** account and one **Personal** account. The Business email is the payee. The Personal account is the buyer you will log in as on the approval page.

### (b) Put the credentials in backend/.env

```sh
cp backend/.env.example backend/.env
```

Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Leave `PAYPAL_ENV=sandbox` and `PAYPAL_ADAPTER=rest`. `backend/.env` is gitignored. Never commit it.

A missing secret exits at startup with `PAYPAL_CLIENT_SECRET is required for the rest adapter`. An empty client id stays on mock, and `/health` shows `"paypal": "mock"`.

### (c) One live create, approve, and capture

Run `npm run dev:backend`. Check `http://127.0.0.1:8787/health` shows `"paypal": "rest"`.

The demo payee has to be the sandbox Business email. The bike thread has no email in the messages, so the extension sends the attribute. In `demo/marketplace.html`, on `#thread-bike`, change `data-pb-seller-email` from `jonas.holm@example.com` to that Business email. The card input is hidden while the attribute is set. The camera thread is `#thread-camera` if you use that one instead.

Then `npm run serve:demo`, open `http://localhost:8080/demo/marketplace.html?live=1`, and press **Switch to a PayPal order**. **Open approval** is the PayPal sandbox page. Log in as the Personal buyer, approve, go back to the chat, and press **I approved it, capture**.

Or, with the backend already running, one create (use the Business email):

```sh
curl -s http://127.0.0.1:8787/api/protect \
  -H 'content-type: application/json' \
  -d '{"item":"Used road bike","amount":1800,"currency":"DKK","payeeEmail":"BUSINESS_SANDBOX_EMAIL"}'
```

Open the `approveUrl` from the JSON, approve as the Personal buyer, then:

```sh
curl -s -X POST http://127.0.0.1:8787/api/orders/ORDER_ID/capture \
  -H 'content-type: application/json' \
  -d '{}'
```

Write down anything that differs from the fixtures in `backend/test/paypal-rest.test.mjs`: status strings, link `rel`s, and `details[].issue` values. The tests use `CREATED` on create, `payer-action` for the approve link, and issues `ORDER_NOT_APPROVED`, `PAYER_ACTION_REQUIRED`, and `ORDER_ALREADY_CAPTURED`. Watch the live create status: the fixture is `CREATED`, and PayPal may send `PAYER_ACTION_REQUIRED` before the buyer acts. The adapter copies `status` through. The card keeps saying awaiting approval until the status is `APPROVED`, then capture. If a field name or an issue code differs, change `backend/src/paypal-rest.js` and the matching test. Keep fetch mocked. Do not record tokens or the secret in the test.

### (d) Decide on the toolkit

Keep the stub, or wire the real `@paypal/agent-toolkit`.

The stub is what ships now. Same client id and secret as rest. DKK, EUR, and USD. Payee email is sent. No extra npm dependencies. `POST /api/protect` does not ask a model which tool to call.

The published 1.11.0 package is the other option. Its `create_order` schema has no payee, and `currencyCode` is USD only, so a seller email and a DKK listing cannot go through that schema as published. The package also depends on `ai`, `openai`, `langchain`, `axios`, and the PayPal server SDK. `package.json` has no `dependencies` entry (`playwright-core` is optional, for screenshots and smoke). A switch belongs in `backend/src/paypal-toolkit.js` only after that trade-off is accepted. The comment at the top of that file is the place the client would plug in.

### (e) Hosting

Example: a Render web service. Build command `npm install`. Start command `npm run dev:backend` (`node backend/src/server.js`).

Needed change, not done in this branch: `start()` in `backend/src/server.js` listens on `127.0.0.1` and `::1` only. There is no `HOST` variable. A platform process on loopback is unreachable from the internet. Add a bind such as `0.0.0.0`, and keep reading `PORT` (already `Number(env.PORT || 8787)`, which is what Render sets). Do that in a follow-up. This handoff does not change the listen call.

Put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and any model key in the platform's environment settings. Do not commit `backend/.env`.

Set `ALLOWED_ORIGINS` to the origin of the page that will call the API. Origins that start with `chrome-extension://` are already allowed.

The extension options field **Backend URL** must be the hosted URL (default is `http://localhost:8787`). `extension/manifest.json` `host_permissions` lists only `http://localhost:8787/*` and `http://127.0.0.1:8787/*`. Add the hosted origin there too. Content scripts match `http://localhost/*`, `http://127.0.0.1/*`, and `file:///*`. A hosted demo page needs a match as well, or the card will not inject.

The return page has to be a hosted page. Set `PAYPAL_RETURN_URL` and `PAYPAL_CANCEL_URL` (if you set only the return URL, cancel stays on `http://localhost:8080/demo/checkout-return.html?cancel=1`). PayPal redirects the browser to those. `GET /return` and `GET /cancel` in `server.js` still redirect to the hardcoded localhost demo page, and in rest mode they do not approve the order. Buyers who come back through `PAYPAL_RETURN_URL` never hit that route. The return page hides **Approve (mock)** unless `mock=1` is in the query.

### (f) Code review checklist

- Token never logged. The server log line is `order <id> <status>`. 502 bodies are an error code only. PayPal `message` and `description` are not copied into our JSON. A 400 message that contains `authorization`, `bearer `, `access_token`, or `client_secret` is replaced with `bad_request`.
- Sandbox guard. `PAYPAL_ENV` must be `sandbox` or startup throws. `PAYPAL_BASE_URL` must be https and the host must be `api-m.sandbox.paypal.com` or `api.sandbox.paypal.com`.
- Idempotency id. Create and capture each send a new `PayPal-Request-Id` UUID. The single 401 retry of that same call reuses the id. A second `POST /api/protect` from the client gets a new id and creates another order. Capture issue `ORDER_ALREADY_CAPTURED` loads the existing capture and returns it.
- Error mapping. PayPal 404 becomes HTTP 404 `not_found`. Issues `ORDER_NOT_APPROVED` and `PAYER_ACTION_REQUIRED` become 409 `not_approved`. Other 400 and 422 become 400 `bad_request` with a constant-only message. 401 and 403 refresh the token once, then 502 `paypal_auth`. Other PayPal failures are 502 `paypal_error`.
- OpenRouter key never echoed. `/health` returns `llm` and `llmProvider` and does not return the key or the model. Classify failures are `{ "error": "llm_error" }` or `{ "error": "llm_off" }`. `classify.js` uses the messages `llm error` and `llm <status>` and drops the provider body.

## Known risks / open questions

- Mock orders are a `Map` inside one Node process. They disappear on restart, and a second process cannot see them. Rest orders live at PayPal. This process does not keep an order list. The OAuth token cache is also in memory. A restart just fetches a new token.
- The payee must be a sandbox account, the Business one you created. `jonas.holm@example.com` is fictional and PayPal will reject it. The issue name on that reject has not been seen live.
- `PayPal-Request-Id` is per call, so a client retry of protect creates a new order. It is not a stable key for "the buyer clicked once".
- Rest currency is DKK, EUR, or USD. Any other 3-letter code is 400 `currency must be DKK, EUR, or USD` and fetch is not called. Mock still accepts any 3-letter code.
- No live call was ever made. Real PayPal responses are unverified: status names, link `rel`s, and error `details[].issue` values. The same is true of OpenRouter. Treat the tests as a contract with a mocked fetch, and adjust the adapter when the first live response disagrees.
