# Backend contract

This is the handoff for the real PayPal adapter. The extension and the mock server already speak this HTTP API. `backend/src/paypal.js` returns the mock adapter when `PAYPAL_CLIENT_ID` is empty. If a client id is set and `PAYPAL_ADAPTER` is `rest` or `toolkit`, `createOrdersPort` throws `not implemented yet: see docs/BACKEND-CONTRACT.md`.

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

`amount` is a positive number. Format it as a string with two decimals (`1800` becomes `"1800.00"`) before it leaves for PayPal. `currency` is a 3-letter code, stored upper-case. `payeeEmail` may be empty. `referenceId` is a UUID when the caller omits it.

The object also has `mode`: `"mock"`, `"rest"`, or `"toolkit"`.

Adapter choice:

| Condition | Adapter |
|---|---|
| `PAYPAL_CLIENT_ID` missing or blank, or `PAYPAL_ADAPTER=mock` | mock, even if the example env says `rest` |
| client id set and adapter is `rest`, `toolkit`, or empty | throw the not-implemented error until those adapters exist |

### Mock behaviour (already implemented)

- Ids look like `MOCK-<uuid>`. Capture ids look like `MOCK-CAP-<uuid>`.
- `approveUrl` is `http://localhost:8080/demo/checkout-return.html?token=<id>&mock=1`.
- Status moves `CREATED` to `APPROVED` to `COMPLETED`.
- Approve happens on `GET /return?token=` or `POST /api/orders/:id/approve-mock`.
- Capture of a `CREATED` order throws status 409, code `not_approved`.
- A second capture returns the same `captureId`.
- The store is in memory and dies with the process.

## HTTP

Listen on `127.0.0.1` and `::1` so both `localhost` (often `::1` first) and `127.0.0.1` work. Default port `8787`.

JSON bodies. Reject a body over 16 kB with 413 before parsing. Empty body counts as `{}`.

### CORS

Reflect `Origin` when it is listed in `ALLOWED_ORIGINS` (comma-separated) or starts with `chrome-extension://`. Send `Vary: origin`, methods `GET, POST, OPTIONS`, and allow header `content-type`. Other origins get no allow-origin header. `OPTIONS` returns 204.

If `ALLOWED_ORIGINS` is unset, the server allows `http://localhost:8080` and `http://127.0.0.1:8080`.

### Routes

`GET /health`

```json
{ "ok": true, "name": "PayBrake", "env": "sandbox", "paypal": "mock", "llm": "off" }
```

`paypal` is the adapter mode. `llm` is `"configured"` when `LLM_BASE_URL` is non-empty, otherwise `"off"`.

`POST /api/classify`

Request: `{ "text": "Send 500 kr via Friends & Family" }`

When `LLM_BASE_URL` is empty, respond **503** `{ "error": "llm_off" }` and do not call a provider.

When it is set, `classifyText` POSTs to `{LLM_BASE_URL}/chat/completions` with `temperature: 0`, `response_format: { "type": "json_object" }`, model `LLM_MODEL` or `gpt-4o-mini`, and `Authorization: Bearer …` only if `LLM_API_KEY` is set. Every evidence quote must be a whitespace-normalized substring of `text`. If any quote fails, the result is `{ "risky": false, "evidence": [], "level": "none", "reason": "" }`. A usable result looks like:

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

`reason` is dropped when it is empty, longer than 120 characters, or matches the banned-phrase check in `backend/src/classify.js`. Provider failures are **502** `{ "error": "llm_error" }`.

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

`item` is required. `amount` must be a positive number. `currency` must match `^[A-Z]{3}$` after upper-casing. `payeeEmail` is optional; if present it must look like an email. The `verdict` object is stored by the extension and ignored by the mock port.

Response:

```json
{
  "orderId": "MOCK-3f1c2a4e-0000-4000-8000-000000000000",
  "status": "CREATED",
  "approveUrl": "http://localhost:8080/demo/checkout-return.html?token=MOCK-3f1c2a4e-0000-4000-8000-000000000000&mock=1",
  "mode": "mock"
}
```

`GET /api/orders/:id` returns `{ "orderId", "status" }` only. Unknown id is **404** `{ "error": "not_found" }`.

`POST /api/orders/:id/capture` returns `{ "orderId", "status": "COMPLETED", "captureId" }`. Not approved yet is **409** `{ "error": "not_approved" }`.

`POST /api/orders/:id/approve-mock` is the mock-only helper the demo approval page calls. It returns the same shape as get, with `status: "APPROVED"`. A real adapter does not need this route if `GET /return` approves the order before redirecting.

`GET /return?token=` approves a mock order, then **302** to `http://localhost:8080/demo/checkout-return.html?token=<id>&mock=1`.

`GET /cancel?token=` redirects to that page with `cancel=1` and does not approve.

### Error shapes

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "bad_request", "message": "..." }` | invalid JSON, missing item, bad amount, bad currency, bad email |
| 404 | `{ "error": "not_found" }` | unknown order |
| 409 | `{ "error": "not_approved" }` | capture before approval |
| 413 | `{ "error": "payload_too_large" }` | body over 16 kB |
| 502 | `{ "error": "llm_error" }` | provider failure |
| 503 | `{ "error": "llm_off" }` | classify while `LLM_BASE_URL` is empty |
| 500 | `{ "error": "internal" }` | anything else. No stack in the body |

## What the extension reads

Default backend URL in options: `http://localhost:8787`. The service worker never throws on a dead backend. It returns `{ "ok": false, "error": "Could not reach PayBrake. Start the backend and try again." }` and the card shows that one line.

| Call | Fields the card uses |
|---|---|
| `GET /health` | `paypal` (`"mock"` shows the mock mode tag), `llm` |
| `POST /api/protect` | `orderId`, `status`, `approveUrl`, `mode` |
| `GET /api/orders/:id` | `status` (`APPROVED` unlocks capture, `COMPLETED` is paid) |
| `POST /api/orders/:id/capture` | `status` |
| `POST /api/classify` | `risky`, `level`, `reason`, `evidence[]`, optional `item`, `amount`, `currency`. 503 `llm_off` keeps the rules level |

The model may confirm or lower a rules hit. It must not be able to raise one. Evidence that is not a substring silences the card.

Paid copy, owned by the extension: `Paid with PayPal Goods & Services (sandbox). Buyer Protection may be eligible; see PayPal terms.`

## Env

See `backend/.env.example`.

| Name | Role |
|---|---|
| `PAYPAL_ENV` | must be `sandbox` or the process refuses to start |
| `PAYPAL_ADAPTER` | `mock`, `rest`, or `toolkit` |
| `PAYPAL_CLIENT_ID` | empty selects mock |
| `PAYPAL_CLIENT_SECRET` | OAuth client secret for `rest`. Never commit a value |
| `LLM_BASE_URL` | OpenAI-compatible origin. Empty means classify returns 503 |
| `LLM_API_KEY` | bearer token, omitted from the request when empty |
| `LLM_MODEL` | defaults to `gpt-4o-mini` |
| `PORT` | default 8787 |
| `ALLOWED_ORIGINS` | comma-separated page origins |

`backend/src/server.js` loads `backend/.env` with a tiny parser. It fills only unset or empty keys and never prints values.

## Return and cancel URLs

Send these on the real create-order call:

- return: `http://localhost:8080/demo/checkout-return.html` (the server also accepts the token query on `GET /return` and redirects)
- cancel: the same page with `cancel=1`, via `GET /cancel`

For a real order the approve URL is PayPal's `payer-action` link (fallback `approve`), not the demo page. The demo page is where PayPal sends the browser afterwards. It is clearly marked mock and has no PayPal logo. A real return should still land on a page that tells the buyer to go back to the chat and capture.

## Tests the real adapter must keep passing

Already green with no credentials (`node --test backend/test/`):

- `formatAmount` uses two decimals
- `assertSandbox` throws for `PAYPAL_ENV=live`
- empty client id selects mock even when `PAYPAL_ADAPTER=rest`
- `rest` and `toolkit` throw the not-implemented string
- mock create, approve, capture, idempotent recapture, and the demo `approveUrl`
- `GET /health` reports `paypal: "mock"` and `llm: "off"`
- `POST /api/protect` returns a `MOCK-` id and `approveUrl`
- capture before approval is 409, then approve-mock and capture return `MOCK-CAP-`
- `GET /return` marks the order `APPROVED` and redirects
- bad JSON and `{}` are 400, a ~20 kB body is 413
- classify is 503 `{ "error": "llm_off" }` when the base URL is empty
- CORS reflects the demo origin and any `chrome-extension://` origin, and omits the header for other origins
- evidence quotes must be substrings; the fetch wrapper sends `temperature: 0`

Add these when `rest` exists, with `fetch` mocked and no network:

- OAuth token is cached until `expires_in - 60` seconds
- create-order body: `intent: "CAPTURE"`, payee email, 2-decimal amount, currency, `PayPal-Request-Id`
- approve link is the `payer-action` rel, with `approve` as fallback
- capture and 4xx/5xx mapping
- sandbox guard still refuses a live base URL

## TODO for the rest adapter

- [ ] OAuth `POST /v1/oauth2/token` (client credentials) and cache the token until `expires_in - 60s`
- [ ] `POST /v2/checkout/orders` with `intent: "CAPTURE"`
- [ ] `purchase_units[0]`: `reference_id`, `description` = item, `amount.currency_code`, `amount.value` with two decimals, `payee.email_address`
- [ ] `payment_source.paypal.experience_context`: `return_url`, `cancel_url`, `user_action: "PAY_NOW"`
- [ ] Send a new `PayPal-Request-Id` UUID on POSTs
- [ ] Approve URL = link `rel` `payer-action`, else `approve`
- [ ] `GET /v2/checkout/orders/{id}` and `POST /v2/checkout/orders/{id}/capture`
- [ ] Support DKK, EUR, and USD
- [ ] Map PayPal errors onto the status codes above. Never put a token or stack in the JSON

## TODO for classify on a real provider

- [ ] Keep the evidence-substring guard and the reason sanitizer in `backend/src/classify.js`
- [ ] Keep temperature 0 and JSON object output
- [ ] Treat transport failures as 502 `llm_error`. The extension then caps a high rules hit at medium and sets `llm: "error"`
- [ ] A 503 `llm_off` must not lower the rules level

## TODO for toolkit

- [ ] Confirm whether `@paypal/agent-toolkit` `create_order` accepts `payee.email_address`
- [ ] If it does not, the agent may still choose the arguments, but execution goes through the `rest` adapter
- [ ] Do not add the package until that path is real. This build has no runtime dependencies
