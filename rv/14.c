Claude review:

VERDICT: CHANGES REQUESTED

REASON: The fix fills a real gap. None of #15–#20 covers bare `transfer`/`wire` to an IBAN or bank, so it isn't superseded. But the PR conflicts with main (DIRTY) in both files it touches and needs a rebase and a re-run of the eval.

- **Rebase conflicts.** Since this branch was cut, #17, #18 and #20 have added rules to `RULES` and changed `allow()` in `extension/lib/atoms.js`, and #17 also changed `pay-risk.js`. All six PRs appended tests to the end of `tests/pay-risk.test.mjs`. After resolving, re-run `node --test` and `npm run eval` against the combined detector set and update the counts in the description (65 pass, 16/14) to match.
- **IBAN gate is now looser.** `transferVerbNear` lets the word `transfer` anywhere within 80 characters unlock the IBAN pattern `[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}`, which has no checksum. A message like "I can transfer the bike to you, frame no. WT12A3B4C5D6E7F8" will now fire `off_platform`. Add a negative test that puts a frame serial or order ID next to non-payment "transfer". Better still, require an amount nearby (`amountNear`) as well as the verb.
- **New bank rule has no money gate.** The `(wire|transfer) … to (my) bank (account)` rule uses only `gate: "negation"`, so it fires without any amount or pay context. Something like "I'll transfer the photos to my bank of images" is contrived but would match. Using the same `payWordNear || amountNear` gate as the deposit rule would be safer.
- **Rule doesn't check the start of a word.** `(?:wire|transfer)` can match inside a longer word, e.g. "firewire … to my bank". Add a lookbehind `(?<![\p{L}\p{N}])` (with the `u` flag) so it matches what `transferVerbNear` already does.
- **Narrow coverage of how the bank is named.** Only `to bank`, `to my bank` and `to my bank account` match. "to our bank", "to the bank account" and "to your account" are missed, and so are Danish and Swedish "overfør"/"överför … til min konto". At least note these as follow-ups, since the rest of the rules are bilingual.
- **Up to 6 words between the verb and "to".** `{0,6}` with the `(?!to\b)` guard can stretch across a clause boundary, such as a comma followed by a new sentence. Stopping the skipped words at `[.,;!?]` would cut down on accidental matches.
- **Test import.** The tests rely on `index.js` exporting `atoms` with a `hasPayWord` function. Confirm that export still exists after the rebase. The `hasPayWord(...) === false` assertions are good because they pin the rule that `transfer` is not a pay word.
- **Description.** The `npm test` / PR #9 caveat should be updated once rebased: either say #9 has landed, or keep the explicit `node --test` command.
