# Backend contract

The extension and the server speak this HTTP API. `backend/src/paypal.js` picks the adapter. An empty `PAYPAL_CLIENT_ID` always selects mock, including when `PAYPAL_ADAPTER=rest`. With a client id, `rest` (or an empty adapter) uses `backend/src/paypal-rest.js`, and `toolkit` uses `backend/src/paypal-toolkit.js`, which executes through rest.

Do not log tokens, secrets, or request bodies. Log `order <id> <status>` only.

## OrdersPort

`createOrdersPort(env)` calls `assertSandbox` first. `PAYPAL_ENV` must be exactly `sandbox` after trim and lower-case. Anything else, including an empty value, throws `Refusing to start unless PAYPAL_ENV=sandbox`.

```js
createOrder({ item, amount, currency, payeeEmail, referenceId })
  -> { orderId, status, approveUrl }

getOrder(id)
  -> { orderId, status, captureId, approveUrl } | null

captureOrder(id)
  -> { orderId, status, captureId }
```

`amount` is a positive number. `formatAmount` writes two decimals (`1800` becomes `"1800.00"`) before it leaves for PayPal. `currency` is a 3-letter code, stored upper-case. `payeeEmail` may be empty. `referenceId` is a UUID when the caller omits it. `protectDeal` in `backend/src/agent.js` always passes one.

The object also has `mode`: `"mock"`, `"rest"`, or `"toolkit"`.

Adapter choice when `PAYPAL_ENV=sandbox`:

| Condition | Adapter |
|---|---|
| `PAYPAL_CLIENT_ID` missing or blank, or `PAYPAL_ADAPTER=mock` | mock, even if the example env says `rest` |
| client id set and adapter is `toolkit` | toolkit (needs `PAYPAL_CLIENT_SECRET`; calls rest) |
| client id set and adapter is `rest` or empty | rest (needs `PAYPAL_CLIENT_SECRET`) |
| client id set and adapter is anything else | throw `Unknown PAYPAL_ADAPTER` |

A missing secret throws `PAYPAL_CLIENT_SECRET is required for the rest adapter` at startup. The message does not include the secret.

### Mock behaviour

- Ids look like `MOCK-<uuid>`. Capture ids look like `MOCK-CAP-<uuid>`.
- `approveUrl` is `http://localhost:8080/demo/checkout-return.html?token=<id>&mock=1`.
- Status moves `CREATED` to `APPROVED` to `COMPLETED`.
- Approve happens on `GET /return?token=` or `POST /api/orders/:id/approve-mock`.
- Capture of a `CREATED` order throws status 409, code `not_approved`.
- A second capture returns the same `captureId`.
- The store is in memory and dies with the process.
- Any 3-letter currency is accepted. The rest currency list applies only to rest and toolkit.

### Rest behaviour

`createRestPort` talks to the sandbox Orders v2 API. Tests inject `fetch`. Nothing in this repo calls the network.

Base URL: `PAYPAL_BASE_URL` with trailing slashes removed, or `https://api-m.sandbox.paypal.com`. The host must be `api-m.sandbox.paypal.com` or `api.sandbox.paypal.com`, and the scheme must be `https`. Anything else throws `Refusing non-sandbox PayPal base URL`.

Timeout: `PAYPAL_TIMEOUT_MS` when it is a number above 0, otherwise 10000. Each call uses `AbortSignal.timeout`. A thrown fetch becomes 502 `paypal_error`. The error text does not include the transport message.

OAuth: `POST {base}/v1/oauth2/token` with `content-type: application/x-www-form-urlencoded`, body `grant_type=client_credentials`, and `authorization: Basic` of `clientId:clientSecret`. The access token is cached until `expires_in - 60` seconds. A missing or non-numeric `expires_in` is treated as 0, so the next call fetches again. Concurrent callers share one in-flight token request. The token is kept in memory on this process.

Orders calls send `authorization: Bearer …`. Create and capture also send a new `PayPal-Request-Id` UUID. A 401 or 403 clears the cache and retries that same call once, with the same request id. A second 401 or 403 is 502 `paypal_auth`. The token endpoint itself is not retried; a 401 or 403 from it is already `paypal_auth`.

`POST /v2/checkout/orders` with `prefer: return=representation` and this JSON:

- `intent`: `"CAPTURE"`
- `purchase_units[0].reference_id`: the given id, or a new UUID
- `purchase_units[0].description`: the item, cut at 127 characters
- `purchase_units[0].amount`: `{ currency_code, value }` with the two-decimal string
- `purchase_units[0].payee`: `{ email_address }` when the email is non-blank after trim. A blank email omits `payee`
- `payment_source.paypal.experience_context`: `return_url`, `cancel_url`, `user_action: "PAY_NOW"`, `shipping_preference: "NO_SHIPPING"`, `brand_name: "PayBrake demo"`

`return_url` is `PAYPAL_RETURN_URL` or `http://localhost:8080/demo/checkout-return.html`. `cancel_url` is `PAYPAL_CANCEL_URL` or that page plus `?cancel=1`.

Currency must be `DKK`, `EUR`, or `USD` after upper-case. Anything else is 400 `bad_request` with message `currency must be DKK, EUR, or USD`, and fetch is not called.

The approve URL is the link with `rel` `payer-action`. If that href is missing, the link with `rel` `approve`. If neither exists, `approveUrl` is null. `orderId` and `status` are copied from the PayPal JSON (`id` and `status`).

`GET /v2/checkout/orders/{id}` returns null on PayPal 404. The id is URL-encoded. A 2xx body maps to `{ orderId, status, captureId, approveUrl }`. `captureId` is `purchase_units[0].payments.captures[0].id` when that string is non-empty, otherwise null.

`POST /v2/checkout/orders/{id}/capture` sends a JSON object `{}` and a new `PayPal-Request-Id`. PayPal 404 returns null. A 422 whose `details[].issue` is `ORDER_NOT_APPROVED` or `PAYER_ACTION_REQUIRED` throws 409 `not_approved`. A 422 `ORDER_ALREADY_CAPTURED` loads the order with GET and returns `{ orderId, status, captureId }`. Other failures use the map below.

PayPal error mapping (`paypalError` plus the 422 cases above):

| PayPal | This server |
|---|---|
| 404 on get or capture | `null`, which the route sends as 404 `not_found` |
| 422 `ORDER_NOT_APPROVED` or `PAYER_ACTION_REQUIRED` | 409 `not_approved` |
| 422 `ORDER_ALREADY_CAPTURED` on capture | the existing capture from GET |
| other 400 or 422 | 400 `bad_request`. Message is `PayPal rejected the order` or `PayPal rejected the order: ISSUE`. `ISSUE` is the first `details[].issue` that matches `^[A-Z][A-Z0-9_]*$`, otherwise `name` if it matches. PayPal's `message` and `description` are dropped |
| 401 or 403 | one refresh, then 502 `paypal_auth` |
| anything else, including 5xx, 429, a thrown fetch, or a token body with no `access_token` | 502 `paypal_error` |

HTTP bodies for 502 are `{ "error": "paypal_auth" }` or `{ "error": "paypal_error" }`. They do not include the token, the secret, or the PayPal body.

### Toolkit behaviour

Finding, checked against `@paypal/agent-toolkit` 1.11.0: `create_order` has no payee field, and `currencyCode` is USD only. The package depends on `ai`, `openai`, `langchain`, `axios`, and the PayPal server SDK. It is not installed. The comment at the top of `backend/src/paypal-toolkit.js` records that.

The stub still exposes `tools` named `create_order`, `get_order`, and `pay_order`. `create_order` adds PayBrake fields the published schema does not have: `payeeEmail`, and `currencyCode` of `DKK`, `EUR`, or `USD`. `runTool` maps those arguments onto a rest order:

- item name is `items[0].name`
- amount is the sum of each line (`itemTotal`, or `itemCost * quantity` when `itemTotal` is empty; quantity defaults to 1), plus `shippingCost`, minus `discount`, rounded to cents
- then `rest.createOrder`, `rest.getOrder`, or `rest.captureOrder`

`createOrder` / `getOrder` / `captureOrder` on the toolkit port are the rest methods. In toolkit mode, `POST /api/protect` calls `runTool("create_order", …)` with one line item (`quantity` 1, `taxPercent` 0, `itemTotal` equal to the amount). There is no model in that path. The response `mode` is `"toolkit"`.

## HTTP

Listen on `127.0.0.1` and `::1` so both `localhost` (often `::1` first) and `127.0.0.1` work. Default port `8787` from `PORT`. There is no host setting. See `docs/CHRISTOPHER-HANDOFF.md` before a public deploy.

JSON bodies. Reject a body over 16 kB with 413 before parsing. Empty body counts as `{}`.

### CORS

Reflect `Origin` when it is listed in `ALLOWED_ORIGINS` (comma-separated) or starts with `chrome-extension://`. Send `Vary: origin`, methods `GET, POST, OPTIONS`, and allow header `content-type`. Other origins get no allow-origin header. `OPTIONS` returns 204.

If `ALLOWED_ORIGINS` is unset, the server allows `http://localhost:8080` and `http://127.0.0.1:8080`.

### Routes

`GET /health`

```json
{
  "ok": true,
  "name": "PayBrake",
  "env": "sandbox",
  "paypal": "mock",
  "llm": "off",
  "llmProvider": "off"
}
```

`paypal` is the adapter mode (`mock`, `rest`, or `toolkit`). `llm` is `"configured"` when `resolveLlm` has a provider, otherwise `"off"`. `llmProvider` is `"typesafe"`, `"openrouter"`, `"openai-compatible"`, or `"off"`. The body never includes the API key or the model name.

With OpenRouter configured and rest selected, the same route looks like:

```json
{
  "ok": true,
  "name": "PayBrake",
  "env": "sandbox",
  "paypal": "rest",
  "llm": "configured",
  "llmProvider": "openrouter"
}
```

`POST /api/classify`

Request: `{ "text": "Send 500 kr via Friends & Family" }`

`text` must be a string. Longer than 4000 characters is **400** `{ "error": "bad_request", "message": "text is too long" }`. Fetch is not called.

When `resolveLlm` is not configured, respond **503** `{ "error": "llm_off" }` and do not call a provider. That includes an empty env, `LLM_PROVIDER=off` (even if keys are set), an unknown provider name, `LLM_PROVIDER=openrouter` with no key, and `LLM_PROVIDER=openai-compatible` with no `LLM_BASE_URL`.

When it is configured, `classifyText` POSTs to `{baseUrl}/chat/completions` with `temperature: 0`, `response_format: { "type": "json_object" }`, and the system prompt in `backend/src/classify.js`.

| Provider | How it is chosen | Base URL | Model when `LLM_MODEL` is empty | Authorization |
|---|---|---|---|---|
| `openrouter` | `LLM_PROVIDER=openrouter`, or provider empty and `OPENROUTER_API_KEY` is set (and `LLM_BASE_URL` is empty) | `LLM_BASE_URL` or `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | Bearer of `OPENROUTER_API_KEY`, or `LLM_API_KEY` if the OpenRouter key is empty. Also sends `HTTP-Referer: https://github.com/lamapony/paybrake` and `X-Title: PayBrake` |
| `openai-compatible` | `LLM_PROVIDER=openai-compatible`, or provider empty and `LLM_BASE_URL` is set | `LLM_BASE_URL` (required) | `gpt-4o-mini` | Bearer of `LLM_API_KEY` only when that value is non-empty |
| `typesafe` | `LLM_PROVIDER=typesafe`, or provider empty, `LLM_BASE_URL` empty and `TYPESAFE_API_KEY` (or the var named by `TYPESAFE_API_KEY_NAME`) is set. Wins over OpenRouter | `TYPESAFE_BASE_URL` or `https://api.typesafe.ai`; requests go to `/v1/systemone` | `TYPESAFE_MODEL` or `jev-1.14.0` | Bearer of the Typesafe key |

Typesafe is a decision model, not a chat model. `classifyText` sends the redacted chat as `state` with three questions: `risky` (yes/no probability), `signal` (choice of the signal ids) and, for chats with more than one Them line, `evidence` (choice of one Them line). The evidence is that line verbatim, `reason` is empty (the extension uses its own card text), `confidence` is p(risky) for a risky verdict and 1 − p for a safe one, and the response carries `addConfidence` (`TYPESAFE_ADD_CONFIDENCE`, default 0.5) which the extension uses as its add bar. `LLM_FALLBACK=openrouter` retries a failed Typesafe call on OpenRouter.

Provider empty and both `LLM_BASE_URL` and `OPENROUTER_API_KEY` set: openai-compatible wins, and the bearer is `LLM_API_KEY`. Trailing slashes on the base URL are removed. `LLM_TIMEOUT_MS` defaults to 8000 when empty, not a number, or not above 0.

Every evidence quote must be a whitespace-normalized substring of `text`. If `risky` is not true, or any quote fails, the result is `{ "risky": false, "evidence": [], "level": "none", "reason": "" }`. A usable result looks like:

```json
{
  "risky": true,
  "level": "high",
  "reason": "Friends & Family + upfront deposit: if the item never arrives, you may have no way to get your money back.",
  "evidence": ["Friends & Family"],
  "item": null,
  "amount": null,
  "currency": null
}
```

`level` is `"high"` only when the model said `"high"`. Any other level on a passing result becomes `"medium"`. `reason` is replaced when it is empty, longer than 120 characters, or matches the banned-phrase check in `backend/src/classify.js`. A fenced ` ```json ` body is accepted. Provider failures, non-JSON output, and a thrown fetch are **502** `{ "error": "llm_error" }`. The provider body is discarded. Error text is `llm error` or `llm <status>` and does not include the key.

`POST /api/protect`

```json
{
  "item": "Used road bike",
  "amount": 1800,
  "currency": "DKK",
  "payeeEmail": "jonas.holm@example.com",
  "verdict": { "level": "high", "signals": ["friends_family"], "reason": "..." }
}
```

`item` is required. `amount` must be a positive number. `currency` must match `^[A-Z]{3}$` after upper-casing. On rest and toolkit, a code outside DKK, EUR, and USD is then **400** `currency must be DKK, EUR, or USD`. `payeeEmail` is optional; if present it must look like an email. The `verdict` object is not sent to PayPal. The extension keeps it.

Mock response:

```json
{
  "orderId": "MOCK-3f1c2a4e-0000-4000-8000-000000000000",
  "status": "CREATED",
  "approveUrl": "http://localhost:8080/demo/checkout-return.html?token=MOCK-3f1c2a4e-0000-4000-8000-000000000000&mock=1",
  "mode": "mock"
}
```

Rest and toolkit return the same four fields. `orderId`, `status`, and `approveUrl` come from PayPal. `mode` is `"rest"` or `"toolkit"`. Offline tests fixture `status: "CREATED"` and a `payer-action` href. The adapter does not rename `status`.

`GET /api/orders/:id` returns `{ "orderId", "status" }` only. Unknown id, and a PayPal 404, are **404** `{ "error": "not_found" }`.

`POST /api/orders/:id/capture` returns `{ "orderId", "status", "captureId" }`. Not approved yet is **409** `{ "error": "not_approved" }`. PayPal 404 is **404** `{ "error": "not_found" }`.

`POST /api/orders/:id/approve-mock` exists for the mock approval page. On mock it returns `{ "orderId", "status": "APPROVED" }`. Rest and toolkit have no `approve` function, so this route is **404** `{ "error": "not_found" }`.

`GET /return?token=` in mock mode approves the order, then **302** to `http://localhost:8080/demo/checkout-return.html?token=<id>&mock=1`.

In rest or toolkit mode, `GET /return` does not approve anything. PayPal is where approval happens. The handler **302**s to `http://localhost:8080/demo/checkout-return.html?token=<id>` with no `mock=1`. That redirect target is hardcoded in `backend/src/server.js`. It is not `PAYPAL_RETURN_URL`. The usual sandbox path never hits this route: PayPal sends the browser to `return_url` directly.

`GET /cancel?token=` never approves. It redirects to the same demo page with `cancel=1`. `mock=1` is added only when `mode` is `mock`.

`demo/checkout-return.html` shows **Approve (mock)** only when the query has `mock=1`. Without it, the button is hidden and the page tells the buyer to go back to the chat and press **I approved it, capture**.

### Error shapes

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "bad_request", "message": "..." }` | invalid JSON, missing item, bad amount, bad currency, bad email, text over 4000 characters, PayPal 400/422 that is not an approval issue |
| 404 | `{ "error": "not_found" }` | unknown order, PayPal 404, `approve-mock` on rest or toolkit, any other path |
| 409 | `{ "error": "not_approved" }` | capture before approval, including PayPal issues `ORDER_NOT_APPROVED` and `PAYER_ACTION_REQUIRED` |
| 413 | `{ "error": "payload_too_large" }` | body over 16 kB |
| 502 | `{ "error": "paypal_error" }` | PayPal transport failure, 5xx, 429, or other non-auth PayPal failure |
| 502 | `{ "error": "paypal_auth" }` | PayPal 401 or 403 after one token refresh |
| 502 | `{ "error": "llm_error" }` | classify provider failure. Also the fallback when a 502 code is neither `paypal_error` nor `paypal_auth` |
| 503 | `{ "error": "llm_off" }` | classify while `resolveLlm` is not configured |
| 500 | `{ "error": "internal" }` | anything else. No stack in the body |

A 400 `message` that matches `authorization`, `bearer `, `access_token`, or `client_secret` is replaced with `bad_request`.

### PayPal statuses the extension may see

The card polls `GET /api/orders/:id` every 2 seconds (`extension/content.js`). It only branches on two values:

| Status | What the card does |
|---|---|
| `PAYER_ACTION_REQUIRED` | Stays on "awaiting approval". This is a PayPal order status from before the buyer finishes. A capture in that state is 409 `not_approved` when PayPal's issue is `PAYER_ACTION_REQUIRED` |
| `APPROVED` | Shows "Approval received." Capture is the next step |
| `COMPLETED` | Marks the order paid and stops polling |

`CREATED` is what the offline create fixture returns. The card treats it like any status other than `APPROVED` and `COMPLETED`: still awaiting approval. Live create can differ. The adapter returns PayPal's string as-is.

## What the extension reads

Default backend URL in options: `http://localhost:8787`. The service worker never throws on a dead backend. It returns `{ "ok": false, "error": "Could not reach PayBrake. Start the backend and try again." }` and the card shows that one line.

| Call | Fields the card uses |
|---|---|
| `GET /health` | `paypal` (`"mock"` shows the mock mode tag). `llm` and `llmProvider` are for operators and for `npm run eval` live mode. The extension does not read them |
| `POST /api/protect` | `orderId`, `status`, `approveUrl`, `mode` |
| `GET /api/orders/:id` | `status` (`APPROVED` unlocks the approval line, `COMPLETED` is paid) |
| `POST /api/orders/:id/capture` | `status` |
| `POST /api/classify` | `risky`, `level`, `reason`, `evidence[]`, optional `item`, `amount`, `currency`. 503 `llm_off` keeps the rules level |

The model may confirm or lower a rules hit. It must not be able to raise one. Evidence that is not a substring silences the card.

Payee email, in order: an email written in the chat, otherwise `data-pb-seller-email` on the thread (`extension/lib/extract.js` and `extension/content.js`). The card input **Seller email for this order** is rendered only when both are missing.

Paid copy, owned by the extension: `Paid with PayPal Goods & Services (sandbox). Buyer Protection may be eligible; see PayPal terms.`

## Env

See `backend/.env.example`. `backend/src/server.js` loads `backend/.env` with a tiny parser. It fills only unset or empty keys and never prints values. A value already set in the process environment wins. Restart after editing the file.

| Name | Role |
|---|---|
| `PAYPAL_ENV` | must be `sandbox` or the process refuses to start |
| `PAYPAL_ADAPTER` | `mock`, `rest`, or `toolkit`. Empty with a client id means rest |
| `PAYPAL_CLIENT_ID` | empty selects mock |
| `PAYPAL_CLIENT_SECRET` | required for rest and toolkit once the client id is set. Never commit a value |
| `PAYPAL_BASE_URL` | empty uses `https://api-m.sandbox.paypal.com`. Only the two sandbox hosts over https are accepted |
| `PAYPAL_RETURN_URL` | PayPal `return_url`. Empty uses the local demo return page |
| `PAYPAL_CANCEL_URL` | PayPal `cancel_url`. Empty uses the demo return page with `?cancel=1`. Set this too if you change the return URL |
| `PAYPAL_TIMEOUT_MS` | milliseconds. Empty, zero, or not a number uses 10000 |
| `LLM_PROVIDER` | `typesafe`, `openrouter`, `openai-compatible`, or `off`. Empty auto-selects as in the classify section |
| `TYPESAFE_API_KEY` | Typesafe key. Never commit a value. `TYPESAFE_API_KEY_NAME`, `TYPESAFE_BASE_URL`, `TYPESAFE_MODEL`, `TYPESAFE_ADD_CONFIDENCE` and `LLM_FALLBACK` are described in `backend/.env.example` |
| `OPENROUTER_API_KEY` | OpenRouter key. A key alone counts as configured. Never commit a value |
| `LLM_BASE_URL` | base for openai-compatible, or an override of the OpenRouter base. Empty and no OpenRouter key means 503 |
| `LLM_API_KEY` | bearer for openai-compatible. Fallback OpenRouter key when `OPENROUTER_API_KEY` is empty. Omitted from the request when empty |
| `LLM_MODEL` | overrides the provider default |
| `LLM_TIMEOUT_MS` | milliseconds. Empty, zero, or not a number uses 8000 |
| `PORT` | default 8787. Bind address is still `127.0.0.1` and `::1` |
| `ALLOWED_ORIGINS` | comma-separated page origins |

## Return and cancel URLs

On the create-order call the rest adapter sends:

- `return_url`: `PAYPAL_RETURN_URL` or `http://localhost:8080/demo/checkout-return.html`
- `cancel_url`: `PAYPAL_CANCEL_URL` or that page with `?cancel=1`

PayPal's approve link (`payer-action`, else `approve`) is what **Open approval** opens. The demo page is where PayPal sends the browser afterwards. It has no PayPal logo. Without `mock=1` it tells the buyer to go back to the chat and capture.

`GET /return` and `GET /cancel` on this server always redirect to the hardcoded localhost demo page. They are the mock flow. In rest mode, `/return` does not change the PayPal order.

## Tests the adapters keep passing

Offline, no credentials, no network (`node --test backend/test/` and `npm test`):

- `formatAmount` uses two decimals
- `assertSandbox` throws for `PAYPAL_ENV=live`
- empty client id selects mock even when `PAYPAL_ADAPTER=rest`
- rest and toolkit build a port when the client id and secret are set; a live base URL throws `Refusing non-sandbox PayPal base URL`; an unknown adapter throws `Unknown PAYPAL_ADAPTER`
- mock create, approve, capture, idempotent recapture, and the demo `approveUrl`
- `GET /health` reports `paypal: "mock"`, `llm: "off"`, and, when only `OPENROUTER_API_KEY` is set, `llm: "configured"` and `llmProvider: "openrouter"` with the key absent from the body
- `POST /api/protect` returns a `MOCK-` id and `approveUrl` in mock mode
- capture before approval is 409, then approve-mock and capture return `MOCK-CAP-`
- `GET /return` marks a mock order `APPROVED` and redirects with `mock=1`
- in rest mode, `GET /return` redirects with the token and without `mock=1`, and does not approve
- bad JSON and `{}` are 400, a ~20 kB body is 413
- classify is 503 `{ "error": "llm_off" }` when no provider is configured
- CORS reflects the demo origin and any `chrome-extension://` origin, and omits the header for other origins
- evidence quotes must be substrings; the fetch wrapper sends `temperature: 0`
- OAuth token is cached until `expires_in - 60` seconds, and concurrent creates share one token request
- create-order body: `intent: "CAPTURE"`, payee email, 2-decimal amount, currency, experience context, `PayPal-Request-Id`
- approve link is the `payer-action` rel, with `approve` as fallback
- capture, `ORDER_ALREADY_CAPTURED`, and 4xx/5xx mapping (`paypal_auth`, `paypal_error`, 409 `not_approved`)
- PayPal 404 on get and capture becomes null
- GBP never calls fetch
- toolkit `runTool("create_order")` posts the same Orders v2 body, and `POST /api/protect` returns `mode: "toolkit"`
- classify provider failures are 502 `llm_error` and do not echo the key

## TODO for the rest adapter

- [x] OAuth `POST /v1/oauth2/token` (client credentials) and cache the token until `expires_in - 60s`
- [x] `POST /v2/checkout/orders` with `intent: "CAPTURE"`
- [x] `purchase_units[0]`: `reference_id`, `description` = item, `amount.currency_code`, `amount.value` with two decimals, `payee.email_address`
- [x] `payment_source.paypal.experience_context`: `return_url`, `cancel_url`, `user_action: "PAY_NOW"` (also `shipping_preference: "NO_SHIPPING"` and `brand_name: "PayBrake demo"`)
- [x] Send a new `PayPal-Request-Id` UUID on POSTs
- [x] Approve URL = link `rel` `payer-action`, else `approve`
- [x] `GET /v2/checkout/orders/{id}` and `POST /v2/checkout/orders/{id}/capture`
- [x] Support DKK, EUR, and USD
- [x] Map PayPal errors onto the status codes above. Never put a token or stack in the JSON

Live sandbox responses are still unverified. That is Christopher's step in `docs/CHRISTOPHER-HANDOFF.md`.

## TODO for classify on a real provider

- [x] Keep the evidence-substring guard and the reason sanitizer in `backend/src/classify.js`
- [x] Keep temperature 0 and JSON object output
- [x] Treat transport failures as 502 `llm_error`. The extension then caps a high rules hit at medium and sets `llm: "error"`
- [x] A 503 `llm_off` must not lower the rules level

OpenRouter is wired through `resolveLlm`. A live model call has not been made.

## TODO for toolkit

- [x] Confirm whether `@paypal/agent-toolkit` `create_order` accepts `payee.email_address`. It does not. `currencyCode` on 1.11.0 is USD only
- [x] Execution goes through the `rest` adapter. The tool list is still `create_order`, `get_order`, `pay_order`
- [x] Do not add the package until a payee is accepted, or until USD-only is an explicit choice. `package.json` has no `dependencies` entry (`playwright-core` is an optionalDependency for screenshots)
