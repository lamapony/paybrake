Claude review:

VERDICT: CHANGES REQUESTED
REASON: The regex fix is correct and none of #15–#20 covers it, so this PR is still needed. But the reported checks ran on a base from before #15–#20, and #17 changed `pay-risk.js`, which the new tests depend on. Rebase onto main and re-run the tests before merging.

- **Stale validation:** The 66 passing tests and the eval are from the old base, which still used the pre-#9 test script. `mergeable=CLEAN` only means the text merges without conflicts. It doesn't show that the tests pass on main. Re-run `npm test` and `npm run eval` after rebasing.
- **#17 overlap:** #17 changed `pay-risk.js` and added the upfront, in advance, holding fee and reserve phrases. The new test expects exactly `friends_family` and `upfront_deposit`, plus `deal.amount === 500`. Check that #17 didn't rename or split `upfront_deposit`, or change which signals a "deposit … now" message produces.
- **Regex change (`atoms.js:93`):** `when\s+you\s+pick(?:\s+it)?\s+up` correctly drops the "pick a time" match. "pay/cash when you pick …" is still covered by the rules at lines 92 and 95.
- **Small regression:** "when you pick **them** up" and "when you pick **the lamp** up" no longer match. Use `(?:\s+(?:it|them))?` at least, or add a test that records the narrower match as intended.
- **Remaining over-match:** "when you pick up" still fires on things like "text me when you pick up the phone", which would veto silently. This existed before the PR, but it's worth a TODO or a test showing it's accepted.
- **Import check:** `tests/pay-risk.test.mjs` now imports `atoms` from `extension/lib/index.js`. Confirm main still exports `atoms` there. #18 and #20 rebased `atoms.js` but didn't touch the index.
- **Test overlap:** Both new `findAtoms` checks in `pay-risk.test.mjs` repeat what `atoms.test.mjs` already covers. Keep the `detect` assertions and drop the repeated atom checks.
- **Known gap:** "Friends & Family, or cash on pickup" is still a silent veto. Open a tracking issue for it so it doesn't get lost.

As you asked, I didn't use tools, so none of this is checked against main's actual `atoms.js` or `pay-risk.js`.
