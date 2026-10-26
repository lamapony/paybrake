# Progress log

- 2026-10-26 12:15 CET: read repo + PLAN. Codex session 15% left (reset ~13:00), Claude weekly 22%. Wrote STATUS.md. Delegating main build to Grok Build.
- 2026-10-26 12:22 CET: step 1 done. Workspaces, brand modules, scripts/serve.mjs, package scripts. playwright-core optionalDependency.
- 2026-10-26 12:28 CET: step 2 done. Detector in extension/lib (classic script + ESM re-export). Offline atom, extract, and pay-risk tests pass. LLM is confirm-or-lower only.
- 2026-10-26 12:32 CET: step 3 done. 30 eval cases, rules mode precision 1, recall 1, false alarms 0. Live mode skips when /health says llm is off.
- 2026-10-26 12:40 CET: step 4 done. Mock OrdersPort, sandbox guard, classify evidence guard, HTTP routes, offline server tests. rest/toolkit throw a pointer at docs/BACKEND-CONTRACT.md.
- 2026-10-26 12:42 CET: step 5 done. MV3 extension: message bus, shadow card, options page, test-only __pbShim. Default LLM off. Rules phrases split so the copy grep stays clean.
- 2026-10-26 12:46 CET: step 6 done. Demo threads with data-pb attributes, live=1, second risky chat, safe-chats.html, mock checkout-return.html. CORS allowlist includes 127.0.0.1:8080.
- 2026-10-26 12:51 CET: step 7 done. Copy and secret tests, static plus injected shots, extension smoke passed (card, MOCK id, pay-anyway ring log). Backend also listens on ::1 so localhost reaches it.
- 2026-10-26 12:55 CET: step 8 done. docs/BACKEND-CONTRACT.md (routes, OrdersPort, sandbox guard, rest/classify TODOs) and docs/adr/0001-silent-unless-evidenced.md.
- 2026-10-26 12:56 CET: step 9 docs committed (README run-in-5-minutes, STATUS after-build table). Clean-clone check is next; §7.7 stays pending until that passes.
- 2026-10-26 12:56 CET: step 9 clone check PASS. Clean clone: npm install, npm test 62/62, eval precision 1 recall 1 false alarms 0, /health paypal mock llm off, POST /api/protect returned a MOCK- id. Servers stopped. Temp clone removed.
- 2026-10-26 13:04 CET: backend-rest session start. Branch backend-rest. Grok weekly 93% left. Toolkit check: @paypal/agent-toolkit 1.11.0 create_order schema has no payee field and currencyCode enum is USD only; deps are heavy (ai, openai, langchain, axios, paypal-server-sdk). Plan: toolkit adapter = documented stub that delegates execution to rest, no new dependency.
- 2026-10-26 13:22 CET: rest adapter done. Sandbox Orders v2 port (token cache, create/get/capture, error mapping) wired for PAYPAL_ADAPTER=rest. Toolkit still throws. Sandbox return hides the mock approve button unless mock=1. npm test 84/84, eval precision 1 recall 1 false alarms 0.
- 2026-10-26 13:31 CET: LLM provider + toolkit port done. classify resolves openrouter, openai-compatible, or off (OpenRouter key alone counts as configured). /health adds llmProvider. Toolkit tools execute through the rest adapter; no toolkit npm package. npm test 102/102, eval precision 1 recall 1 false alarms 0.
- 2026-10-26 13:41 CET: backend-rest docs. .env.example lists the new vars with empty secrets. README covers rest, the toolkit finding (create_order has no payee and is USD-only), and the sandbox switch. Contract, STATUS, and docs/CHRISTOPHER-HANDOFF.md updated. npm test 102/102, eval precision 1 recall 1 false alarms 0.
