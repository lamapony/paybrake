# Progress log

- 2026-10-26 12:15 CET: read repo + PLAN. Codex session 15% left (reset ~13:00), Claude weekly 22%. Wrote STATUS.md. Delegating main build to Grok Build.
- 2026-10-26 12:22 CET: step 1 done. Workspaces, brand modules, scripts/serve.mjs, package scripts. playwright-core optionalDependency.
- 2026-10-26 12:28 CET: step 2 done. Detector in extension/lib (classic script + ESM re-export). Offline atom, extract, and pay-risk tests pass. LLM is confirm-or-lower only.
- 2026-10-26 12:32 CET: step 3 done. 30 eval cases, rules mode precision 1, recall 1, false alarms 0. Live mode skips when /health says llm is off.
- 2026-10-26 12:40 CET: step 4 done. Mock OrdersPort, sandbox guard, classify evidence guard, HTTP routes, offline server tests. rest/toolkit throw a pointer at docs/BACKEND-CONTRACT.md.
- 2026-10-26 12:42 CET: step 5 done. MV3 extension: message bus, shadow card, options page, test-only __pbShim. Default LLM off. Rules phrases split so the copy grep stays clean.
- 2026-10-26 12:46 CET: step 6 done. Demo threads with data-pb attributes, live=1, second risky chat, safe-chats.html, mock checkout-return.html. CORS allowlist includes 127.0.0.1:8080.
