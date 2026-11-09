# Codex task (paste into `codex exec`)

Suggested invocation, from this repo root (`/workspace/payguard`), after 18:00 Copenhagen when Codex quota is back:

```sh
cd /workspace/payguard && codex exec --full-auto "$(sed -n '/^---8<---$/,$p' CODEX-TASK.md | tail -n +2)"
```

Do not use "Limit Reset Credits". Grok Build continues from where Codex stops (after 18:40), using the same prompt plus the "Status" section Codex leaves at the end of README.

---8<---
You are building PayBrake in this repository (current directory). Read `SPEC.md` fully before writing code; it is the source of truth. Also read `README.md` and `LICENSE`. `demo/marketplace.html` and `scripts/shot-demo.cjs` may already exist (built from the concept mockup); keep their look and IDs (`#pb-card`, `#pb-protect`, `#pb-anyway`), and extend the page with the `data-pb-*` attributes and the `?live=1` mode from SPEC §3 and §7.5.

Reference code to port patterns from (read-only, private, never copy its content wholesale): `/workspace/feed-lens` — especially `lib/classify.js`, `lib/atoms.js`, `lib/ask-typesafe.js`, `lib/tidy.js`, `background.js`, `content.js`, `scripts/eval-gold.mjs`, `tests/classify.test.mjs`. SPEC §3 lists exactly what to reuse and what must NOT be copied (no gold.json, no tune/, no launch/, no logs, no .env, no Facebook/X/LinkedIn selectors, no TypeSafe questions).

Work in this order and commit locally after each step with a clear message (git is initialised; do NOT add a remote, do NOT push, do NOT create any GitHub repo):
1. Root `package.json` scripts (`test`, `eval`, `dev:backend`, `serve:demo`, `shots`, `e2e`), workspace package.json files, `extension/lib/brand.js`, `backend/src/brand.js`.
2. `extension/lib/atoms.js`, `extract.js`, `pay-risk.js`, `tidy.js` + `tests/atoms.test.mjs`, `tests/extract.test.mjs`, `tests/pay-risk.test.mjs` (SPEC §4). Precision first: silent unless evidenced; the LLM can only confirm or lower.
3. `eval/cases/pay-risk.json` (30 synthetic cases, SPEC §6, fictional names, en + da) and `eval/run-eval.mjs`. Tune atoms until rules mode hits precision ≥ 0.95 with zero false alarms and recall ≥ 0.80. Do not delete or soften hard negatives to pass.
4. Backend (SPEC §5): `rest` + `mock` adapters first with full tests using a mocked `fetch`; then `classify.js` with evidence-substring guard; then `agent.js`; then the `toolkit` adapter using `@paypal/agent-toolkit` (inspect its `create_order` schema in node_modules and record in README whether `payee.email_address` is supported).
5. Extension: `manifest.json`, `background.js`, `content.js` (single `demo` adapter row), card in Shadow DOM, options page, override ring log.
6. `tests/copy.test.mjs` (copy rule + no Meta branding), Playwright screenshots and the extension smoke (SPEC §7.4, §7.5). Chromium: `/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`; global `playwright-core` is at `/home/box/.local/lib/node_modules/playwright-core` (use `require(process.env.PWC || "playwright-core")` or add `playwright-core` as a devDependency). Look at the PNGs you produce and fix layout issues.
7. README: run-in-5-minutes, architecture diagram (text), what is mock vs sandbox, limits, and a final "Status" section listing each SPEC §7 check as PASS/FAIL/NOT DONE with the command output summary.

Rules:
- No secrets anywhere in the repo. Never print env values. `backend/.env` is gitignored; only `.env.example` with empty values is committed.
- `npm test` must be offline. Live PayPal or LLM calls only in `scripts/live-sandbox.mjs` and `eval --mode=live`, both skipping cleanly without creds.
- UI copy says Buyer Protection "may be eligible"; never "guaranteed" or "you are protected".
- Fictional names only. No Facebook/Meta/Messenger names, logos or look-alike UI.
- Keep dependencies minimal; no frameworks in the extension; no build step.
- Do not kill processes you did not start; stop dev servers you start (by their PID) before finishing.

Finish with a short summary: what is built, the output of `npm test`, `npm run eval`, the screenshot paths, and what is not done.
