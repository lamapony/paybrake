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
