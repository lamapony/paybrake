# PayBrake promo page (draft)

Static page for the PayPal AI Hackathon submission. No build step: open `index.html` or serve this folder.

- `img/hero.webp`, `img/og.jpg`, `img/favicon.svg`: made fresh for this page.
- Other `img/*.webp`: real Playwright screenshots of the unpacked extension on `demo/marketplace.html?live=1` with the backend in mock mode. `thread-bike`, `thread-camera` and `live-390` were retaken from the v0.2.0-test.2 zip against the hosted demo (branch tester-friendly); `options` was retaken from branch eval-real-scams (66910b8, "AI check on all chats" setting) against the hosted demo, with one example override-log entry seeded; the rest are from backend-rest d6f4004 and show no changed UI.
- `noindex` via meta tag, `_headers` and `robots.txt`. Preview only, on Cloudflare Pages.

Placeholders to fill: demo video URL, Devpost URL, team roles.

## Interactive section (#try)

`js/engine/*.js` are verbatim copies of `extension/lib/{brand,tidy,atoms,extract,redact,pay-risk}.js` from branch eval-real-scams (66910b8, rules v3: codes/card details, suspicious links, fee via link, remote access, impersonation). The v0.2.0-test.2 zip still has the older rules, and the page says so. The page demo is rules only; no AI check runs here. Eval numbers on the page come from `eval/real/RESULTS.md` on that branch (test split). Re-copy the engine files when the rules change. `js/sim.js` (live rule card) and `js/quiz.js` (spot the red flag) run them in the browser; nothing is sent anywhere.
