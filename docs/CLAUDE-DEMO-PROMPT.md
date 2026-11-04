Build `demo/marketplace.html` in this repo (cwd). It is the demo surface for a Chrome extension called **PayBrake** that warns about risky payment requests in marketplace chats, BEFORE the user pays.

Reference style: read `/workspace/paypal-hackathon/mockup/index.html` and look at `/workspace/paypal-hackathon/mockup/mockup-1280.png` and `mockup-390.png`. Match that look closely (layout, palette, typography, card design), but apply the changes below.

Requirements
- One self-contained HTML file: inline CSS, inline SVG, no external requests, no fonts from CDNs. A small inline <script> is allowed only for the two buttons (see below).
- A believable but fully FICTIONAL generic marketplace called "Marketplace" (neutral grey-blue, generic shop icon). NO Meta/Facebook branding, no blue "f", no Messenger look-alike logos. Fictional names only: seller "Jonas Holm", buyer "you". Danish kroner.
- Listing: "Used road bike", 1,800 kr, aluminium frame, size 56, seller joined 3 weeks ago, 0 ratings.
- Chat: buyer "Hi! Is the road bike still available?"; seller "Yes, but several people are asking 🙂"; seller "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow". Highlight the evidence spans in that bubble: "500 kr deposit", "Friends & Family", "I ship tomorrow".
- Under that bubble, the injected extension risk card (static mock, but give the card root `id="pb-card"` and `data-pb-risk="high"` so tests can find it):
  - badge "High risk payment request", "Checked just now"
  - one line: "Friends & Family + upfront deposit: if the bike never arrives, you may have no way to get your money back."
  - "Detected signals" chips: Friends & Family · Upfront deposit · Ships before meeting
  - primary button `id="pb-protect"`: "Switch to a PayPal order"; secondary `id="pb-anyway"`: "Pay anyway"
  - footer: "PayBrake · AI check · only you can see this"
- Side panel "Protected order preview" with a "SANDBOX DEMO" tag, text-only "PayPal" wordmark (plain text, no logo image), item, payee "jonas.holm@example.com", payment type "Goods & Services", amount 1,800 kr, and the row **Buyer Protection: "may be eligible"** (pill reads "may be eligible*"). Footnote: "*Eligibility depends on PayPal terms and the transaction. Sandbox demo, no real payment is made." NEVER say protection is guaranteed, never a bare "eligible" or "protected" claim.
- Below the chat, a second smaller "safe chat" example (another fictional seller, e.g. "Mette Lund", selling a lamp, 250 kr, "Pick up Saturday, pay on collection with MobilePay is fine" is RISKY, so instead use: "Sure, pay through the Marketplace checkout or cash when you pick it up") with a quiet note "PayBrake stayed silent: no risky payment request" to show no false alarm.
- Top banner: "DEMO — fictional marketplace and names. Not affiliated with any payment provider or social network."
- Header pill "PayBrake active".
- Buttons: clicking `#pb-protect` swaps the card footer to a status line "Sandbox order created · ID 5O190127TN364715T · awaiting approval" (static fake ID, labelled sandbox). Clicking `#pb-anyway` collapses the card to a one-line "You chose to pay anyway. Logged on this device." No network calls.
- Responsive: 1280 px two columns (chat + 360 px side panel); under 900 px stack; at 390 px buttons full-width, min 44 px tall. Accessible contrast, focus outlines, reduced motion.
- No form inputs that look like login. Chat composer is a static shape.

Verify yourself: write `scripts/shot-demo.cjs` that uses `require(process.env.PWC || "playwright-core")` with chromium executablePath `/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`, opens `demo/marketplace.html` via file://, and saves full-page screenshots to `shots/demo-1280.png` (1280x800, dpr 1) and `shots/demo-390.png` (390x844, dpr 2), plus `shots/demo-1280-protect.png` after clicking `#pb-protect`. Run it with `PWC=/home/box/.local/lib/node_modules/playwright-core node scripts/shot-demo.cjs`, look at the PNGs, fix layout problems (overflow, clipped text, overlapping), and re-shoot. Also assert in the script that `#pb-card` is visible at both widths and that the page text contains "may be eligible" and does NOT contain "guaranteed", "Facebook" or "Meta" (exit non-zero otherwise).

Do not touch other files except `demo/marketplace.html`, `scripts/shot-demo.cjs`, `shots/*`. Do not install packages. Do not use git. End with a short summary of what you built and verification results.
