# PayBrake promo page

Static one-page site for the PayPal AI Hackathon submission. No build step: open `index.html` or serve this folder. All CSS is inline in `index.html`; there is no JavaScript.

The page is one narrow column: a one-line description, one screenshot, "Try PayBrake in 2 minutes" (demo link, public zip, 3 install steps), rules-only accuracy numbers, a privacy note, one collapsed "Details" block and a footer. One typeface (system stack), one accent (the logo orange `#fd9a1c`).

Draft only. It does not link to GitHub while the repo is private. The download is the public zip on the demo worker.

## Images

Checked in. This repo has no script that regenerates them.

- `img/logo.svg`: the same file as `extension/logo.svg`.
- `img/favicon.svg`: the same file as `hosted/static/favicon.svg`. `img/favicon-32.png` is the 32 px PNG of that mark. There is no `hero.webp`.
- `img/chat-card.webp`: Playwright screenshot of the extension on the hosted demo `demo/marketplace.html?live=1`, bike chat, card from rules plus the AI check, PayPal in mock mode. Taken at a 480 px viewport, 2x, so the text stays readable at 390 px.
- `img/og.jpg`: 1200x630, composed from that screenshot plus the logo and one line of text.

`og:url` and `og:image` are absolute URLs on `https://preview.paybrake-preview.pages.dev/`.

## Numbers

The page quotes the rules-only rules v4 test split in `eval/real/RESULTS.md` (remeasured 3 Nov 2026): recall 0.456 (325 / 713), false-positive rate 0.009 (8 / 860), precision 0.976. The 26 Oct rules-plus-AI headline was not re-run after later detectors and is not shown.

## Indexing

`noindex` via the meta tag, `_headers` and `robots.txt`. Preview only, on Cloudflare Pages.
