# Demo v2: judge path report (10 Nov 2026)

Branch: `main` (committed directly: only demo, start-page, test and README files changed).
Commits: `ddc2d8d` feat(demo): five chats in the built-in preview, each card the rules' own · `e6a77f2` feat(hosted): start page leads with the built-in preview · plus the commit that adds this folder.

**Preview URL: not deployed.** The command from the brief failed before uploading anything:

```
$ cd hosted && npx wrangler deploy --name paybrake-demo-preview --workers-dev
✘ [ERROR] Unknown arguments: workers-dev, workersDev
```

(wrangler 4.160.0 has no `--workers-dev` flag.) Per the brief I stopped there and did not try another deploy command. `hosted/wrangler.jsonc` already has `"workers_dev": true`, so the likely working command is `cd hosted && npx wrangler deploy --name paybrake-demo-preview`. Dima should confirm before running it. Prod (`paybrake-demo`, version a0df3caf…) was not touched.
The "after" shots were taken against `npx wrangler dev` on 127.0.0.1:8788, running the real Worker on the built `hosted/public`. Nothing was deployed.

## Scores

| Block | Score | What changed |
|---|---|---|
| 0 Audit | n/a | Before shots of prod. Weak points below. |
| 1 Start page | 8.5 | Amber masthead and serif hero, as on /promo. One primary button, **See it work now** → `/demo/marketplace.html` (no live=1). Next to it, a small copy of the bike message and card. "In the demo store" lists the 3 steps with deep links (`#camera`, `#console`, `#lamp`). "Try the real extension" is the second path: zip, 3 steps, store in extension mode, safe chats. "What is real" covers rules, AI and PayPal, with live status from `/health`. Fonts load from `/promo/fonts/`. |
| 2 Marketplace | 8.5 | Opens on the bike chat with the High risk card visible above the fold at 1280. A chat picker (an inbox, a horizontal strip on narrow screens) offers 5 chats: bike (F&F deposit), camera (MobilePay), **new** chair (move to WhatsApp, pay to reserve), **new** console (gift card codes), lamp (no card). Each listing sits in its chat header. The order panel follows the open chat: Switch → Approve (mock) → Capture (mock). Guide steps get ticked as you go. Page chrome follows promo. The card CSS is unchanged apart from the system-ui font, so it matches the extension's shadow-root card. |
| 3 Honesty | 8.5 | Each static card is **checked by a test against the real rules engine** (level, reason, labels, quotes, highlighted words). The footer says "rules check". The page states that the preview does not call the AI. After protect it reads "Sandbox order created (preview) · sample ID …". Capture reads "Captured (mock) … Nothing was sent to PayPal." Server line from `/health`: "PayPal mock (no sandbox keys set) · AI check on/off". Without `/health`: "sandbox when configured, otherwise mock". Buyer Protection stays "may be eligible*" with the footnote. No guaranteed, protected or 100% claims, and no PayPal logo. |
| 4 Verify | 8 | Tests green, eval clean, build OK, no console errors and no overflow. Preview deploy blocked by the flag error above. |

## Block 0: weak points a 2-minute judge hit (before)

1. The home page's only store button went to `?live=1`. Without the extension there was **no card**, and after 2.5 s a toast said "PayBrake is not running".
2. The home page read like install instructions (zip first). The thing worth seeing was step 2 of 2.
3. Plain system-ui panels, nothing like the promo page.
4. The preview listing was always the bike, even with the camera chat open. The camera chat had a flagged bubble but **no card** in the preview.
5. Only 2 risky chats. The lamp chat sat below the fold as an afterthought.
6. The order preview was static for the bike, with pastel compare boxes and no visible next step after "Switch to a PayPal order".
7. Nothing on the store said what was real (rules vs AI, sandbox vs mock).

## live=1 kept working

- Strips every `<mark>` and `.flagged` inside threads, and removes every `.pb[data-pb-static]` card.
- `#pb-show-thread-1` and `#pb-show-thread-2` keep their ids. The lamp is now `#pb-show-thread-5`, the new chats `-3` and `-4`.
- New chats start `hidden`, so the extension only scans them once opened: `shot-demo` "one card host" still passes.
- Clicking a chat does not change the URL. That matters: `qa-round2-flow` reloads after opening the camera chat and expects the bike chat. A `#chat` deep link is only read on load.
- The missing-extension notice keeps `#pb-missing`. It is now an ink bar with **Open the built-in preview** and **Dismiss**.

## Tests and checks

- `npm test`: **418 tests, 417 pass, 0 fail, 1 skipped** (clean main: 414 / 413 / 1 skipped). +4 new in `tests/demo-scenarios.test.mjs`. The skip is `qa-round2-flow`, which needs `CHROME_PATH`.
- `npm run eval` (rules): **precision 1, recall 1, false alarms 0** (tp 18, fp 0, fn 0, tn 21). Honest-chat false positives: **0 of 21**.
- `npm run hosted:build`: OK (`packed dist/paybrake-extension.zip (PayBrake 0.2.0.4)`).
- `scripts/shot-demo.cjs` (static and live, with the extension scripts injected): **all checks passed**. That covers 44px buttons, a full-width primary button, details collapsed at 390, the card under 40% of the viewport (27%), no overflow, a MOCK order in live mode, no lamp card, and no network requests from file://.
  - Caveat: on this Mac, two orphaned servers from another clone (`~/Code/PayBrake-demo/paybrake`, running 15 days, PID 85580/85582) hold ports 8080 and 8787. I did not kill them. `shot-demo` and `qa-round2-flow` hard-code those ports, so I ran temporary copies on 18080/18787 from `/tmp`. Repo files were not changed.
  - `qa-round2-flow`: every step passes up to the approval popup's return. The backend's approve URL is hard-coded to `localhost:8080` (`backend/src/server.js:12`), so on this machine the popup lands on a different origin and loses the stored order. **Unmodified main fails at the same step in the same harness**, so this comes from the environment. Re-run on a machine with 8080 and 8787 free.
- Console errors (local Worker): **0** on home and marketplace (no live=1) at 1280 and 390, and also on protect, camera, lamp, pay anyway and live views.
- Horizontal overflow: **0 px** on every shot.

## Shots (this folder)

before-home-1280, before-home-390, before-market-1280, before-market-390, before-live-1280, before-live-390, before-promo-1280 (893 KB, left untracked)
after-home-1280, after-home-390, after-market-1280, after-market-390, after-protect-1280, after-protect-390, after-camera-1280, after-lamp-1280, after-lamp-390, after-anyway-390, after-live-1280
`shoot.cjs` regenerates them: `node shots/demo-v2/shoot.cjs <base-url> <before|after>` (uses CHROME_PATH, else the macOS Playwright cache).

## Remaining nits

- At 390 the bike card starts around 1,050 px down: the guide text and chat strip come first. Acceptable; you can still see that the strip scrolls.
- The new chats only get a card in extension mode once opened. That is by design: the extension scans visible threads.
- The start page's copy of the card is static HTML. Its text matches the bike card, but no test checks it against the engine the way the store cards are checked.
- `demo/safe-chats.html` and `demo/checkout-return.html` keep the old system-ui look (not on the main judge path; unchanged).

## Needs Dima

1. Deploy the preview with a working command (see top), check it, then deploy prod yourself (`npm run hosted:deploy`).
2. PayPal sandbox keys on the Worker if you want `/health` to say sandbox. The pages pick that up on their own.
3. Optionally free ports 8080/8787 (stale servers from the other clone) and re-run `CHROME_PATH=… npm test` so `qa-round2-flow` runs end to end.
