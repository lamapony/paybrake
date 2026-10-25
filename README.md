# PayBrake

**Brakes before you pay.** A Chrome extension that spots risky payment requests in marketplace chats (Friends & Family for goods, upfront deposits, off-platform transfers, pressure) and offers to move the deal to a PayPal order instead. Built for the PayPal AI Hackathon 2026. Sandbox only.

> Status: scaffold. See [SPEC.md](SPEC.md) for what is being built.

## How it works

1. Reads the payment request in the chat you have open, on your device.
2. Stays silent unless it finds concrete evidence (regex signals, confirmed by an AI check).
3. Shows a one-line risk card with two choices:
   - **Move to protected PayPal order**: creates a PayPal sandbox order for the item and amount; you approve it in PayPal checkout. PayPal Buyer Protection *may be eligible*, depending on PayPal terms.
   - **Pay anyway**: hides the card and notes your choice locally.

It never posts, types, or clicks anything in the chat.

## Run in 5 minutes

_To be written by the build (SPEC.md §7.7)._

```sh
npm install
cp backend/.env.example backend/.env   # mock mode works with no credentials
npm run dev:backend
npm run serve:demo
# chrome://extensions → Developer mode → Load unpacked → extension/
# open http://localhost:8080/demo/marketplace.html?live=1
```

## Layout

`extension/` Chrome MV3 extension · `backend/` Node service that holds PayPal sandbox credentials · `demo/` fictional marketplace page · `eval/` synthetic chat cases · `tests/` offline tests.

## Disclaimer

Demo with fictional names. Not affiliated with PayPal or any marketplace. Uses the PayPal sandbox; no real money moves.

## License

MIT © 2026 Dmitrii Babinov and Christopher Wang
