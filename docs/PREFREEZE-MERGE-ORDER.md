# Open PRs before the 5 Nov freeze: what to merge, in what order

Written 4–5 Nov 2026 against `origin/main` at `430b9b4`. Freeze rule: before **5 Nov 12:00 Copenhagen**, humans merge **only detection fixes that come with tests**. Everything else waits.

How this was checked: each PR was trial-merged (`git merge --no-ff --no-commit`) into a scratch branch from `origin/main`. Conflicts were resolved by keeping both sides, then `CHROME_PATH= npm test` and `npm run eval` were run. With `CHROME_PATH` unset, the browser flow test skips, as it does in CI. The changed rules were also run against benign marketplace sentences. Nothing was written to GitHub.

Baseline on main: 305 tests, 304 pass, 0 fail, 1 skipped. Eval: precision 1, recall 1, false alarms 0 (tp 18, tn 17).

## Recommendation

| Order | PR | What | Before freeze? | Why |
|---|---|---|---|---|
| 1 | **#56** (this branch) | 15 detection fixes, follow-ups from three independent reviews, a perf memo, a rules-version bump, one stale browser test fixed, plus docs | **Yes**: the detection commits (everything up to `67c810d`, the last commit before the docs) | Branched from current main. 332 pass, 0 fail (Node 20 and 22). Eval 1/1/0. The extension smoke test passes. Each fix has its own commit and its own test block in `tests/prefreeze-1105.test.mjs`. Blocks 16–18 hold every regression the three reviews reproduced. The older Swish/Vipps/Venmo/Zelle gates use main's helpers byte-for-byte; the new gates use separate `*_V5` copies. The docs commits come last and are not detection fixes. Under a strict reading of the freeze, merge `67c810d` (e.g. `git merge 67c810d`) and land the docs after the freeze. |
| 2 | **#37** `grok/pb-wont-ff-1103`: ignore "I won't take PayPal F&F" | Detection fix + tests | **Yes, ideally after a one-line fix** | Fixes a real false alarm (`hn-refuse-ff-checkout` from #32). It conflicts with main (two new functions on the same lines of `atoms.js`). Resolve by keeping both and restoring the closing `}`. **Bug:** "I won't take anything but F&F. 500 kr." and "I don't take anything except PayPal F&F, 500 kr." are medium on main and **silent** with #37 (reproduced). Fix (verified locally: the three scams go back to medium, the refusals stay silent, #37's own tests pass 286/286): in `ffTokenOk` change `take(?:\s+[\p{L}\p{N}]+){0,4}` to `take(?:\s+(?!(?:but\|except\|only)(?![\p{L}\p{N}]))[\p{L}\p{N}]+){0,4}`. |
| 3 | **#32** `eval/known-false-positives` | Tests and eval cases only | **Yes, only after #37** | On main alone, `npm run eval` **exits 1** (precision 0.947, 1 false alarm), which would turn CI red. With #37 (and #56) in: 320 pass, 0 fail, 2 todo, eval 1/1/0 (tn 21). Conflicts at the end of `tests/pay-risk.test.mjs` (both sides append): keep both and put back the shared `});`. Then remove the two `{ todo: true }` flags. Both pass, and `hn-paid-flat-deposit` already passes on main. |
| — | **#35** `grok/pb-nok-sek-1103`: NOK/SEK amounts | Detection fix + tests | **No, wait** | Merges clean and tests pass, but it reads Danish **"nok"** ("probably/enough") as Norwegian kroner. "Det tager nok 2 dage. Jeg holder den til dig." is silent on main and **medium** with #35 (reproduced). Fix: accept NOK/SEK only after the number, or case-sensitive uppercase only. The SEK/NOK gap is real: "Swisha 500 SEK till mig först" is silent on main. |
| — | **#31** `grok/pb-half-upfront-1103`: "half up front", "50% now" | Detection fix + tests | **No, rework** | 7 of 7 ordinary sentences flag, e.g. "The battery is at 50% now and the price is 600 kr.", "No need to pay 50% now, cash when we meet. 500 kr.". It conflicts with main's down-payment rules. An earlier review already contested it. |
| — | **#30** `grok/pb-chat-messenger-1103`: Messenger/Facebook Pay/Snapchat/Viber | Detection fix + tests | **No** | Flags "Message me on Messenger, 500 kr, pickup only." Any amount within 80 characters of the app name counts. It conflicts with #25 on the same line. |
| — | **#25** `grok/pb-chat-signal-1103`: Signal/Discord/iMessage | Detection fix + tests | **No** | Flags "Join us on Discord, tickets are 200 kr at the door." and the refusal "I will not pay via Signal, the price is 500 kr today." |
| — | **#45** `ml/tfidf-lr-skeleton` (draft) | ML skeleton, not wired, flag off | **After freeze** | Not a detection fix. Merges clean, 309/310 pass. |
| — | **#33** `docs/backlog` | Docs | **After freeze** | Stale: it lists #23–#29 as open and describes #32's eval failure as two false alarms. |
| — | **#2** `promo-page` (draft) | `site/` promo page | **After freeze** | Not detection. An owner review requested changes, and those are unresolved. |

## Conflicts to expect

- #56 → #37 → #32 in that order: only the two conflicts described above, both pre-existing between those PRs and main. #56 adds no new conflicts with them. I re-checked this on the final branch by merging all three into a scratch branch: 337 pass, 0 fail, 2 todo, 1 skipped, eval 1/1/0 (tn 21).
- #56 deliberately puts its new rules in one block just above the `pay_on_collection` rules, and keeps its handover checks out of rule lines, so #30, #25 and #31 still apply around it later.
- Every PR that adds tests appends to the end of `tests/pay-risk.test.mjs`, so those conflicts are add-only. #56 uses its own test file to avoid this.

## Not verified here

- `npm run eval:real` (Hugging Face is blocked from this environment). Rules v5 has not been measured on the real datasets.
- `npm run e2e:hosted` and a hosted redeploy.
- CI on #56: check the Actions run on the PR before merging.
