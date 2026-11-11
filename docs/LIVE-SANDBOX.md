# Live PayPal sandbox check

On 7 November 2026, Christopher Wang ran the first live PayPal sandbox payment through the PayBrake backend, with the rest adapter (`backend/src/paypal-rest.js`). Until then, every PayPal test in this repo used mocked responses. No keys, tokens or sandbox account emails are recorded here.

## Setup

- A sandbox Merchant app on developer.paypal.com, with one Business account (the seller) and one Personal account (the buyer).
- `backend/.env` set to `PAYPAL_ENV=sandbox` and `PAYPAL_ADAPTER=rest`, plus the app's client ID and secret. The file is gitignored.
- `npm run dev:backend`. `/health` returned `"env":"sandbox","paypal":"rest"`.

## What was run

| Step | Call | Result |
|---|---|---|
| Create | `POST /api/protect`, 1,800 DKK, payee = Business sandbox email | Order `8G393414KN797352N`, status `PAYER_ACTION_REQUIRED`, approve link `www.sandbox.paypal.com/checkoutnow?token=…` |
| Approve | Approval page, logged in as the Personal sandbox buyer | `GET /api/orders/:id` returned `APPROVED` |
| Capture | `POST /api/orders/:id/capture` | `COMPLETED`, capture `69P119642M712934J` |
| Capture again | Same call repeated | Same capture returned, no second charge |
| Capture before approval | New order, captured right away | `409 {"error":"not_approved"}` |
| Unknown order | `GET /api/orders/NOTAREALORDER123` | `404 {"error":"not_found"}` |

PayPal's capture record, read directly from `GET /v2/payments/captures/{id}`:

| | |
|---|---|
| Gross | 1,800.00 DKK |
| PayPal fee | 63.80 DKK |
| Net | 1,736.20 DKK |
| Credited to the seller | 2,463.94 SEK (rate 1.4192). The Business account's currency is SEK. |
| `seller_protection` | `ELIGIBLE` |

The Business account balance on sandbox.paypal.com showed the +2,463.94 SEK credit.

## Findings

1. **After create, the status is `PAYER_ACTION_REQUIRED`, not `CREATED`.** The fixture in `backend/test/paypal-rest.test.mjs` now matches. The adapter passes the status through, and the extension only acts on `APPROVED` or `COMPLETED`, so no code changed.
2. **PayPal accepts a payee email that is not a sandbox account.** A create with the fictional `jonas.holm@example.com` returned an order (`4VA0990252239333B`) instead of an error. That order was not approved, so where it fails was not tested. Live tests need a real sandbox seller in `data-pb-seller-email` on the demo threads.
3. **Everything else matched the mocked tests:** the `payer-action` approve link, capture idempotency, the `not_approved` mapping, and the 404.
4. **Cross-currency works.** A DKK payment to a SEK seller is converted by PayPal, with the fee taken in DKK.

## Browser flow through the extension (10 November 2026)

This used the unpacked extension, with **Backend URL** set to `http://localhost:8787`, on the local demo page. The bike thread's `data-pb-seller-email` was set to the sandbox Business account, as a local change only.

1. The bike chat showed **High risk payment request** with four signals: Friends & Family, Upfront deposit, Pressure to hurry, and Ships before you meet.
2. **Switch to a PayPal order** created order `78U52197R8397532N` for 1,850.00 DKK.
3. **Open approval** led to the PayPal sandbox, where the Personal buyer approved, paying with a PayPal sandbox test card.
4. **I approved it, capture** gave `COMPLETED`, capture `1SS265485P268973H`. The card then read **Paid with PayPal Goods & Services (sandbox)**.
5. PayPal credited the seller with 2,532.49 SEK after the fee. This showed in both the buyer's and the seller's sandbox Activity.

Two practical notes for anyone repeating it:
- If the browser is still logged in to sandbox.paypal.com as the Business account, the approval page refuses with "you are trying to log in to the seller's account". Log out first, or check balances in a private window.
- Choose **Log in** on the approval page, not the guest card form. If PayPal asks for a card, use one from PayPal's [test card generator](https://developer.paypal.com/credit-card-number-generator), never a real card.

## Not covered

- The hosted Worker. Its `/health` still reports `"paypal":"mock"`, and setting sandbox secrets there is a separate decision.
- Live PayPal. The code refuses anything other than sandbox.

## Reproduce

Follow steps (a) to (c) in [CHRISTOPHER-HANDOFF.md](CHRISTOPHER-HANDOFF.md). Use your own sandbox Business email as the payee.
