# Submission gaps

Early submission: 5 November, 21:00 CET. Final: 12 November. This is a local assessment of `night/1101-submission` against the available `origin/*` refs; no branches were merged or pushed.

## Before going public

Dima decides. Nothing in this section was run on this branch. The pilot is still in the tree on purpose. A top-level notice with the same warning is in [pilot/README.md](../pilot/README.md).

`pilot/extension/manifest.json` injects on Facebook and Messenger, and `pilot/INSTALL-RU.md` directs testers to real chats. That folder is not the judge path. The judge path is the local mock in the repository README.

1. Read `pilot/README.md`, `pilot/INSTALL-RU.md`, `pilot/extension/manifest.json`, and `PILOT-TASK.md`.
2. Check history for the pilot path. An empty result is not proof the blobs are gone from every clone; this is the check to run:

```sh
git log --all -- pilot
```

Also check the task file and the pilot screenshots, which sit outside `pilot/`:

```sh
git log --all -- PILOT-TASK.md
git log --all -- shots/pilot-1280.png shots/pilot-390.png shots/pilot-anyway-1280.png shots/pilot-order-1280.png shots/pilot-order-created-1280.png shots/pilot-safe-1280.png
```

If a later deletion makes that log look shorter than expected, repeat the pilot check without history simplification:

```sh
git log --all --full-history -- pilot
```

3. Decide one of: keep the pilot in a private remote only, move it to a reviewed private location, or drop it from the tree that will be published. To drop it from the next commit (this does not rewrite history):

```sh
git rm -r pilot PILOT-TASK.md
```

The six `shots/pilot-*.png` files are not inside `pilot/`. Include them only as part of the same decision:

```sh
git rm -- shots/pilot-1280.png shots/pilot-390.png shots/pilot-anyway-1280.png shots/pilot-order-1280.png shots/pilot-order-created-1280.png shots/pilot-safe-1280.png
```

4. Review `git status` and `git diff --cached` before committing. Look through `pilot/fixtures/`, the pilot screenshots, documentation, and `eval/` for personal information and for anything the team does not have the rights to publish. `.gitignore` does not untrack a file and does not erase history.
5. After any removal commit, run `git log --all -- pilot` again. If those commits must not be public, rewriting history is a separate decision. Do not treat `git rm` as a history wipe.
6. Confirm the published README, Devpost draft, and demo video point at the local mock (and later a hosted mock only after it is reviewed), not at this pilot.

## Gaps

1. **Public release gate — pilot and data.** `pilot/extension/manifest.json` injects on Facebook and Messenger, and `pilot/INSTALL-RU.md` directs testers to real chats. Before making the repo public, remove or move the third-party-targeting pilot and related instructions (`PILOT-TASK.md`) to an appropriately reviewed private location, or replace them with a local-only fixture. Do not present it as the judge path. Inspect `pilot/fixtures/`, screenshots in `shots/`, documentation, git history, and any evaluation data for personal information and rights to publish. This requires a human review; `.gitignore` alone does not remove tracked files or history. The pilot remains here pending that decision. The commands are in **Before going public** above. They were not run.
2. **Credential-free judge path.** The README now explains the local mock, but first-time judges still install Node and load an unpacked extension. Review #3 `tester-friendly` (`TESTING.md`, `hosted/`, `extension/welcome.html`, `scripts/pack-extension.mjs`) for a maintained hosted mock and zip; verify the actual public URL, build, privacy, availability and end-to-end flow before advertising it. #5 adds a judge start page and zip hosting. No deployment was made here.
3. **Integrate in dependency order, with review.** #1 `backend-rest` is Christopher's sandbox adapter (`backend/src/paypal-rest.js`, `backend/src/paypal-toolkit.js`); review and land it first if sandbox functionality is wanted. #3 includes #1 and adds the tester path; land its reviewed incremental changes next. #4 `eval-real-scams` includes #3 and adds detection changes and `eval/real/`; audit source licenses, personal data, methodology and large checked-in result files before landing. #5 `fix/terra-detection-1027` builds on #4, adding detection fixes and the judge path; review and test those changes after #4. #2 `promo-page` is independent and draft (`site/`); align its claims and links to the final shipped version, then consider it after the working demo. Avoid treating these stacked diffs as independent PRs. No cherry-picks were made: the useful changes are coupled to larger branch histories.
4. **Evidence and presentation.** `npm run shots` and `npm run e2e` were re-run on this branch (see QA). `shots/ext-live-1280.png` matches the current extension card, and `shots/demo.gif` (card, Protect, `MOCK-` order) is embedded in the README. Still open: record and caption the [video script](DEMO-VIDEO-SCRIPT.md), then replace [TODO video link] and [TODO hosted demo] in the [Devpost draft](DEVPOST-DRAFT.md). No hosted demo was deployed. The draft says the evaluation is 30 synthetic cases and does not quote scores as field performance.
5. **Claims and evaluation.** `eval/cases/pay-risk.json` contains 30 synthetic cases; its scores are not evidence of real-world accuracy. Review #4's `eval/real/RESULTS.md` and data provenance before citing its numbers, including split methodology and limitations. Retest the final integrated commit and keep README and promo claims consistent with its actual features.
6. **Repository hygiene.** `LICENSE` already contains MIT terms; confirm copyright and contributor attribution with the team. `.gitignore` excludes environment files, but inspect tracked files and history for secrets, personal data, and third-party assets before publication. The tracked-file grep below is a limited check, not a history or image audit. Rotate any actual credential if discovered.

## QA on this branch


- 2026-11-01: `npm install` with Node 24.22.1 succeeded; npm reported 0 vulnerabilities.
- `npm test`: 62 passed, 0 failed after changing the test command to enumerate test files (Node 24 does not resolve the original directory arguments). The default `/workspace/bin/node` could not load `libnode.so.115`; checks used `/usr/local/bin` first in PATH.
- `npm run eval`: passed; synthetic rules cases: 16 true positives, 0 false positives, 0 false negatives, 14 true negatives; precision, recall and F1 each 1. These are not real-world performance estimates.
- `git grep` on tracked text for credential-related terms, private-key headers, and common token shapes found empty example variables, documentation, test patterns and code referring to environment variables; no populated credential was identified. The automated `tests/secrets.test.mjs` also passed. This does not cover all secret formats, binary files, or git history.
- Browser interaction and screenshots were not re-verified in this environment; verify the final integrated demo before submission.

- 2026-11-01 (second pass): `PATH=/usr/local/bin:$PATH`, Node v24.22.1 at `/usr/local/bin/node`. `/workspace/bin/node` was not used.
- `npm test`: 62 passed, 0 failed, 0 skipped, 0 cancelled. Exit 0. A second run after the README edit also passed, 62/62.
- `npm run eval`: exit 0. 30 synthetic rules cases: 16 true positives, 0 false positives, 0 false negatives, 14 true negatives; precision 1, recall 1, f1 1, false alarms 0. Wrote gitignored `eval/report.json`. These figures are not real-world performance estimates.
- `npm run shots`: the script's fallback binary `chromium-1248` is not installed here. Re-ran with `CHROME_PATH=/home/box/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`. All checks passed (static card, safe page with no card, live High risk card, `MOCK-` order id, 44px targets at 390, no horizontal overflow). Regenerated `shots/demo-1280.png`, `shots/demo-390.png`, `shots/demo-1280-protect.png`, `shots/safe-1280.png`, `shots/live-1280.png`, `shots/live-1280-order.png`, and `shots/live-390.png`. Pixel hashes differ from the previous commit; the pages match this build (static card says "Checked just now", injected card says "MOCK MODE" and "rules check").
- `npm run e2e`: same `CHROME_PATH`. "extension smoke passed". Regenerated `shots/ext-live-1280.png` and `shots/ext-live-390.png`. The 1280 image is the README still: High risk card, four signals, Protect and Pay anyway, lamp thread silent. The 390 image stacks those buttons inside the column.
- `shots/demo.gif`: Playwright frames of `#thread-bike` on `demo/marketplace.html?live=1` (no card, then the injected card, then Protect). ffmpeg 7.1.5 padded the frames onto one canvas and encoded a 768×706, 4.76s, 8 fps GIF (about 61 KB). The order frame shows "Sandbox order created" and `MOCK-7cd411c3-953f-4da9-a4e7-280fe25701d1` from that run; the next run will mint a different id. Embedded in the README.
- The **Before going public** commands were not run. `pilot/` and `PILOT-TASK.md` are still in the tree.
