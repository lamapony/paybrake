# PayBrake promo page

Static one-page site for the PayPal AI Hackathon submission. No build step: open `index.html` or serve this folder. All CSS is inline in `index.html`; there is no JavaScript.

The page is one narrow column: a one-line description, one screenshot, "Try PayBrake in 2 minutes" (demo link, download, 3 install steps), accuracy numbers, a privacy note, one collapsed "Details" block and a footer. One typeface (system stack), one accent (the logo orange `#fd9a1c`).

## Images

- `img/logo.svg`, `img/favicon.svg`, `img/favicon-32.png`: the PayBrake logo, unchanged.
- `img/chat-card.webp`: fresh Playwright screenshot of the real extension (`paybrake-extension.zip` from v0.2.0-test.3) on the hosted demo `demo/marketplace.html?live=1`, bike chat, card from rules + AI check, PayPal in mock mode. Taken at a 480 px viewport, 2x, so the text stays readable at 390 px.
- `img/og.jpg`: 1200x630, composed from that screenshot plus the logo and one line of text.

Script: `/workspace/pb-redesign-logs/shoot.cjs` (screenshots) and `towebp.py` (WebP/JPEG encoding).

## Numbers

Accuracy figures come from `eval/real/RESULTS.md` on branch eval-real-scams (held-out test split, 1,573 messages). Update the page if they change.

## Indexing

`noindex` via the meta tag, `_headers` and `robots.txt`. Preview only, on Cloudflare Pages.
