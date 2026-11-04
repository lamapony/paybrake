Claude review:

VERDICT: CHANGES REQUESTED
REASON: The PR is a self-declared draft ("Do not merge yet") with placeholders still open. Its copy and accuracy numbers come from a build that doesn't match current main: the `backend-rest` / PR #1 build and the `eval-real-scams` numbers, measured before the detectors in #15–#20 landed. It isn't superseded, because nothing on main touches `site/`, but it isn't mergeable yet either.

- **Stale accuracy numbers:** ~85% (603/713) and ~1.6% (14/860) come from `eval/real/RESULTS.md` on the `eval-real-scams` branch. Main has since added the reversed F&F, personal PayPal, Wise, Telegram/WhatsApp, upfront/holding fee/reserve and named-rail (Western Union, Venmo, Swish) detectors. Both recall and false positives have probably moved. Re-run the eval on main or label the numbers with the commit they came from.
- **Copy describes a build that isn't on main:** `/api/classify`, Typesafe `jev-1.14.0`, "AI check on (the default in this build)" and the PayPal Orders v2 sandbox flow all depend on PR #1 / `backend-rest`, which isn't in main's recent history. The privacy paragraph in particular has to match the shipped default exactly.
- **"Rules in English and Danish" is now out of date:** #16 (`på Wise`) and #20 (Swish) add Swedish/Scandinavian phrasing. Update both the "How it works" and "Limits" bullets.
- **`og:image` is relative:** `img/og.jpg` won't resolve in most link-preview crawlers, which need an absolute URL. `og:url` is also missing.
- **PR description and contents disagree:** the description lists `hero.webp` and says `favicon.svg` was made for this page. The diff has no `hero.webp`, and `site/README.md` says the favicon is "the PayBrake logo, unchanged". Fix whichever is wrong.
- **Unrelated binary:** `shots/options-typesafe.png` has nothing to do with `site/`. Drop it or move it to its own commit.
- **README points outside the repo:** `/workspace/pb-redesign-logs/shoot.cjs` and `towebp.py` aren't in the PR, so nobody else can regenerate the images. Commit the scripts or remove the reference.
- **Download link needs repo access:** while the repo is private, "Download the test build" and the GitHub, README and Issues links all 404 for judges. Gate the page on the repo going public, or host the zip somewhere public such as the demo worker.
