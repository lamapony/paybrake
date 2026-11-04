# Submission gaps

Early submission: 5 November, 21:00 CET. Final: 12 November. Re-checked after rebasing onto current main. The **Before going public** commands were not run.

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
6. Confirm the published README, Devpost draft, and demo video point at the README demo (the hosted demo or the local mock), not at this pilot.

## Gaps

1. **Public release gate — pilot and data.** `pilot/extension/manifest.json` injects on Facebook and Messenger, and `pilot/INSTALL-RU.md` directs testers to real chats. Before making the repo public, remove or move the third-party-targeting pilot and related instructions (`PILOT-TASK.md`) to an appropriately reviewed private location, or replace them with a local-only fixture. Do not present it as the judge path. Inspect `pilot/fixtures/`, screenshots in `shots/`, documentation, git history, and any evaluation data for personal information and rights to publish. This requires a human review; `.gitignore` alone does not remove tracked files or history. The pilot remains here pending that decision. The commands are in **Before going public** above. They were not run.
2. **Credential-free judge path.** The README leads with the hosted demo at https://paybrake-demo.spbabinov.workers.dev/ and keeps a local fallback under **Run it locally**. `TESTING.md`, `hosted/`, `extension/welcome.html`, and `scripts/pack-extension.mjs` are on main. This branch did not redeploy the worker or rebuild the zip. Before submission, confirm that public URL, the zip, privacy, and the end-to-end flow still match this commit.
3. **Stacked branches are no longer the integration plan.** The PayPal sandbox adapter (`backend/src/paypal-rest.js`, `backend/src/paypal-toolkit.js`), the tester and hosted path, and `eval/real/` are already on main. On-device detection from the later detector work is on main as well: reversed Friends & Family and gift wording, a personal PayPal payment, Wise, upfront / in advance / holding fee / reserve, Telegram and WhatsApp payment asks, and named rails including Western Union, Venmo, Swish, and Zelle. Do not re-land those as a separate detection branch. `eval/real/` includes large checked-in result files. Do not quote those scores as field performance. Read [eval/real/README.md](../eval/real/README.md) for licenses, what the datasets drop, and the split. A human still needs to review personal data and rights before treating that material as public-submission evidence. `site/` is not in this tree. If a promo-page branch still exists, align its claims with this README before adding it.
4. **Evidence and presentation.** `npm run shots` and `npm run e2e` were re-run after the rebase (see QA). `shots/ext-live-1280.png` is the unpacked extension on the bike thread: **High risk payment request**, four signals (Friends & Family, Upfront deposit, Pressure to hurry, Ships before you meet), **Switch to a PayPal order** and **Pay anyway**, and the AI check off on the mock server. The lamp thread stays silent. `shots/ext-live-390.png` starts with the details collapsed and stacks the buttons. `shots/demo.gif` is that thread with no card, then the card, then the mock order. The static HTML card in `shots/demo-1280.png` is a separate mock: it lists three chips and does not include Pressure to hurry. Still open: record and caption the [video script](DEMO-VIDEO-SCRIPT.md), then replace [TODO video link] in the [Devpost draft](DEVPOST-DRAFT.md). The hosted demo URL is already in that draft. The draft says the evaluation is 35 synthetic cases and does not quote scores as field performance.
5. **Claims and evaluation.** `eval/cases/pay-risk.json` contains 35 synthetic cases. `npm run eval` on this branch reported 18 true positives and 17 true negatives, with precision 1 and 0 false alarms. That is a regression check on those cases, not real-world accuracy. `eval/real/RESULTS.md` is already in the tree. Its older lines about 30 synthetic chats and an earlier test count were not re-run and are not restated here. Review provenance before citing real-eval numbers. Keep README and promo claims consistent with the features on this commit.
6. **Repository hygiene.** `LICENSE` already contains MIT terms; confirm copyright and contributor attribution with the team. `.gitignore` excludes environment files, but inspect tracked files and history for secrets, personal data, and third-party assets before publication. `tests/secrets.test.mjs` runs as part of `npm test`. That is not a history or image audit. Rotate any actual credential if discovered.

## QA

Re-run after rebasing onto current main. One pass. Commands and results only. Figures below are from that pass. They are not real-world performance estimates.

- `npm test`: 253 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo. Exit 0. The command is `node scripts/run-tests.mjs`, which lists `tests/*.mjs` and `backend/test/*.mjs` in Node. It does not depend on the shell expanding globs.
- Clean-clone check: a fresh directory of this branch, `npm install` (0 vulnerabilities), then the same `npm test` (253 passed) and `npm run eval` (precision 1, recall 1, f1 1, false alarms 0, tp 18, tn 17). With `backend/.env` copied from the example and no provider keys in the environment, `/health` reported `"paypal": "mock"` and `"llm": "off"`, and `POST /api/protect` returned a `MOCK-` id with `"mode": "mock"`. `tests/secrets.test.mjs` runs `git grep`, so that directory has to be a git checkout. This pass ran on Node 24. The test script uses Node 20 file and process APIs and was not re-executed on Node 20 or Windows.
- `npm run eval`: exit 0. 35 synthetic rules cases: 18 true positives, 0 false positives, 0 false negatives, 17 true negatives; precision 1, recall 1, f1 1, false alarms 0. The safe cases in this set stayed silent under the rails now on main.
- `npm run shots`: exit 0. All checks passed, including the phone card (the level pill is uppercase via CSS, so the check is case-insensitive). Refreshed `shots/demo-1280.png`, `shots/demo-390.png`, `shots/demo-1280-protect.png`, `shots/live-1280.png`, `shots/live-1280-order.png`, and `shots/live-390.png`. `shots/safe-1280.png` was rewritten and matched the bytes already on main.
- `npm run e2e`: exit 0. Printed `extension smoke passed`. Refreshed `shots/ext-live-1280.png` and `shots/ext-live-390.png`. Desktop card text: **High risk payment request**, signals Friends & Family, Upfront deposit, Pressure to hurry, Ships before you meet, buttons **Switch to a PayPal order** and **Pay anyway**, tag **AI check off (mock server)**. The phone card starts collapsed and stacks the buttons. The lamp thread stays silent.
- `shots/demo.gif`: frames of `#thread-bike` on the local demo with the unpacked extension (no card, then the card above, then the mock order with **Open approval**). Encoded at 768×720, 4.76s, 8 fps. Embedded in the README. The order id in the last frame is from that run and will differ next time.
- `npm run e2e:hosted` was not run. TODO (stale assets): `shots/tester/`, `shots/tester-v2/`, `shots/tester-v3/`, `shots/ai-live/`, and `shots/pilot-*.png` were not regenerated. Do not treat them as current.
- The **Before going public** commands were not run. `pilot/` and `PILOT-TASK.md` are still in the tree.
