Claude review:

VERDICT: CHANGES REQUESTED
REASON: PR #5 adds things main doesn't have (hosted Worker, Typesafe AI check, rest adapter, docs), so PRs #15–20 don't replace it. But it is CONFLICTING with main and has to be rebased onto the new detectors (#15–#20) and re-verified before merge.

- **Rebase conflicts in the detector code.** #17 changed `extension/lib/pay-risk.js`, and this PR adds `clampLevel` in the same file. #15–#20 also added about 800 lines to `atoms.js` and `tests/pay-risk.test.mjs`. The "173/173 pass" and "eval precision 1 / recall 1 / fp 0" numbers are from before the rebase. Re-run `npm test` and `npm run eval` on the rebased branch and update the counts. The new rails (Venmo, Western Union, Swish, Telegram/WhatsApp) may also change eval results on the safe set.
- **`capLevel` may stop the AI from adding a card.** `capLevel(level, "none")` returns `"none"`. If the extension sends `rulesLevel: "none"` when the rules find nothing, the AI can never add a card, which contradicts the PR description. Either omit `rulesLevel` when the rules are silent, or treat `"none"` as "no cap", and add a test for it.
- **Rules level is passed through `env`.** `classifyText` reads `env.PAYBRAKE_RULES_LEVEL`, so a value from the request travels in the config object. Pass it as an explicit argument so it can't mix with real environment settings.
- **Misleading parse error.** When `classifyChat` can't parse the reply, it throws `llm ${res.status}`, which is always "llm 200". Use a separate code such as `llm shape`, as the Typesafe path does.
- **The docs contradict each other.** STATUS.md says live sandbox and hosting are "NOT DONE (needs Christopher)", but the README describes a deployed hosted demo. SPEC says the repo is public, but the PR says it's private, so the issue-template link in TESTING.md won't work for judges. The `PROGRESS.md` note "Grok weekly 93% left" is internal and shouldn't ship.
- **Hard-coded test count.** "`npm test` passes 173 tests" in the README will be wrong as soon as this is rebased. Remove the number or update it after the rebase.
- **Two different length limits.** `TEXT_LIMIT` is 4000 in the backend and 2000 on the hosted Worker. The extension sends at most 1900 characters, so this works, but write down the 4000 limit in `docs/BACKEND-CONTRACT.md` or use one constant for both.
- **Partial review.** The diff was cut off near the start of `backend/src/paypal-rest.js`. I didn't review the rest of that file, the Worker (`hosted/`), the `content.js` render-time clamp, or the extension changes. They need a review after the rebase.
