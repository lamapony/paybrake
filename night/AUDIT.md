# Baseline audit — origin/main (27c0f89)

Run on 1 November 2026 with rules-only detection. `npm install` succeeded (0 reported vulnerabilities). The default environment Node failed to load libnode.so.115; using Node 24, `npm test` failed because directory arguments are not discovered (`package.json:15`). `npm run eval` passed: precision 1, recall 1, 0 false alarms on 30 synthetic cases. `npm run shots` passed static and injected live demo checks at 1280 and 390; `npm run e2e` passed unpacked extension, mock order, override and options smoke. Chromium 1208 was explicitly selected. Neither a real PayPal sandbox nor a live model was exercised.

## Findings, ranked

1. **High — submission blocker:** the checkout adapter is mock only; real PayPal adapters throw (`backend/src/paypal.js:80`). The model is optional and off without configuration (`backend/src/classify.js`); the hackathon requires sandbox and AI to be central. The backend-rest and tester-friendly branches contain work to review, not included here.
2. **High — missed scam asks:** verification code and shipping-label fee have no matching strong rule (`extension/lib/atoms.js:29`); messages 5 and 7 stay silent. Suspicious verification links are not recognised, so message 6 is underrated.
3. **Medium — test command compatibility:** Node 24 does not resolve the directory arguments in `package.json:15`, despite the declared >=20 range.
4. **Medium — veto can hide a risky request:** any collection/checkout phrase anywhere in a thread silences all risk (`extension/lib/pay-risk.js:190`, `extension/lib/atoms.js:92`), even if it describes a later alternative after an upfront transfer. This needs targeted design and regression cases before changing the precision-first policy.
5. **Medium — limited scope:** main has only the demo adapter and English/Danish patterns; it does not run on real marketplace chats (`extension/manifest.json`). The 30-case synthetic eval does not establish real-world accuracy.

## Roleplay messages on main

| Message | Expected | Observed | Match |
|---|---|---|---|
| 1 | high | high | yes |
| 2 | medium | medium | yes |
| 3 | high | high | yes |
| 4 | medium | medium | yes |
| 5 | medium | silent | no |
| 6 | high | medium | no |
| 7 | high | silent | no |
| 8 | high | high | yes |
| 9 | silent | silent (veto) | yes |

Messages are from `/workspace/night-1101/scam-examples.md`; they were evaluated individually with `pbPayRisk.detect` and no AI. Branch context inspected locally: fix/terra-detection-1027 and eval-real-scams contain detector/eval work; tester-friendly includes hosted/tester and backend changes; promo-page contains a separate site; backend-rest contains PayPal and provider adapters. None was merged. Branch names are local remote-tracking refs, not evidence of current PR status.

## Follow-up on this branch

The roleplay rules now match all nine expected levels in rules-only mode, with a regression test. These additions are deliberately narrow and do not establish general phishing detection. The unconditional veto and real sandbox/AI integration remain open. Recreate roleplay images with `CHROME_PATH=/path/to/chrome node scripts/shot-messages.cjs` after `npm install`. The script injects the actual content scripts into `?live=1` in rules-only mode; no payment is made. Message 9 intentionally has no card. The static comparison panel is removed in these images because its original 500 kr claim applies only to the default demo message.
