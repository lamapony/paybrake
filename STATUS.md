# PayBrake: status vs SPEC.md

_Snapshot 2026-10-26 12:15 CET, before the main build session. Updated at the end of the session (see bottom)._

## Before this session

| Area (SPEC §) | State |
|---|---|
| Scaffold, LICENSE (MIT), README stub, SPEC, `.gitignore`, `backend/.env.example` | done |
| `demo/marketplace.html` (§8) | static concept page with a hard-coded mock card (`#pb-card`, `#pb-protect`, `#pb-anyway`); no `data-pb-*` attributes, no `?live=1` mode |
| `scripts/shot-demo.cjs` | static-page screenshots only (`shots/demo-*.png`) |
| `pilot/` | separate live-chat pilot (Codex): MV3 extension for a real social chat, own detector (`pilot/extension/lib/detector.js`, 21 test cases), mock order page, e2e Playwright test. NOT the hackathon build: targets a third-party site and must not ship in the demo/video |
| `extension/` (§1, §2, §8) | empty (`lib/.gitkeep`) |
| Detector `extension/lib/atoms.js`, `pay-risk.js`, `extract.js`, `tidy.js`, `ask-llm.js` (§4) | not started (pilot detector is a reusable starting point) |
| Backend (§5) | empty (`src/.gitkeep`) |
| Eval set + `eval/run-eval.mjs` (§6) | not started |
| Tests (§7.1, §7.3), copy-rule grep | not started (only pilot tests) |
| Root `npm test` | stub that exits 1 |
| README "Run in 5 minutes" (§7.7) | placeholder |
| `demo/safe-chats.html`, `demo/checkout-return.html` | missing |
| docs/adr, docs/BACKEND-CONTRACT.md | missing |

## Ownership

- **Dima:** extension, detector, eval set, card UI, demo page, video, Devpost text.
- **Christopher:** real PayPal sandbox backend (`rest` / `toolkit` adapters, OAuth, Orders v2 create/get/capture, LLM classify on the server, hosting). Contract: `docs/BACKEND-CONTRACT.md`.
- This session builds the backend in **mock mode only** so the click flow works with zero credentials.

## After build session

_2026-10-26. Mock backend, extension, demo, eval, shots, and extension smoke. Real PayPal `rest` / `toolkit` and a live model call are Christopher's._

| SPEC §7 check | Result |
|---|---|
| 7.1 `npm test` offline: atoms, decision, LLM gate, extraction, copy grep, demo brand grep | PASS |
| 7.2 `npm run eval` rules: precision 1, recall 1, F1 1, false alarms 0 (gate is 0.95 / 0.80 / zero false alarms) | PASS |
| 7.2 live eval | skips with exit 0 while `/health` says llm is off. Not a failure |
| 7.3 mock `/api/protect` returns `MOCK-` id and approve URL, capture flow, 400, 413, sandbox guard, CORS, classify 503 `llm_off`, evidence substring guard | PASS |
| 7.3 rest: OAuth token cache, create-order body, `PayPal-Request-Id`, payer-action link | NOT DONE (no rest adapter in this build) |
| 7.4 Playwright static card at 390 and 1280, protect shot, `safe-1280.png` with no card, plus injected live card shots | PASS |
| 7.5 extension smoke: live card within 5s, protect shows `MOCK-`, second thread Pay anyway lands in the ring log, `shots/ext-live-1280.png` and `shots/ext-live-390.png` | PASS |
| 7.6 secret grep on tracked files, `.env` gitignored, `.env.example` empty | PASS |
| 7.7 README run-in-5-minutes from a clean clone | see the clone note in PROGRESS.md after the verify step |
