# Try PayBrake in 2 minutes

No cloning, no servers. You need Google Chrome (or another Chromium browser such as Edge or Brave) on a computer.

The demo store and its test server are online. Everything there is pretend: fictional people, test orders, no real money. PayBrake uses on-device rules plus an AI check to flag a risky payment ask, and offers a PayPal order (sandbox / mock) instead.

## 1. Download and unzip

1. Open the demo start page: **https://paybrake-demo.spbabinov.workers.dev/** (no GitHub account needed).
2. Click **Download paybrake-extension.zip** ([direct link](https://paybrake-demo.spbabinov.workers.dev/paybrake-extension.zip)) and unzip it (double-click it).
3. You now have a folder called **`paybrake-extension`**. Inside it you should see `manifest.json`.

> On Windows, "Extract All" sometimes makes a folder inside a folder: `paybrake-extension\paybrake-extension\`. Use the inner one, the one where you can see `manifest.json`.

## 2. Load it in Chrome

1. Go to **`chrome://extensions`** (type it in the address bar).
2. Switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`paybrake-extension`** folder (the one that contains `manifest.json`, not a folder above it).

If Chrome says **"Manifest file is missing or unreadable"**, you picked the wrong folder. Go one level deeper and pick the folder with `manifest.json` in it.

A **Welcome to PayBrake** tab opens by itself. (If it does not, click the PayBrake icon in the toolbar. It may be hidden under the puzzle-piece icon.)

## 3. Try the demo store

Click the big **Try the demo store** button, or open:

**https://paybrake-demo.spbabinov.workers.dev/demo/marketplace.html?live=1**

What you should see:

1. The **bike** chat with seller Jonas. Under his message *"Send 500 kr deposit via PayPal Friends & Family..."* a PayBrake card appears saying **High risk payment request**, with the reasons it noticed (Friends & Family, upfront deposit, pressure to hurry, ships before you meet). After a second or two it gets an **AI checked** tag: the AI verdict came back from the server.
2. Click **Switch to a PayPal order**. The card shows **Sandbox order created · ID MOCK-...**.
3. Click **Open approval**. A new tab opens. Click **Approve (mock)**. It says **Marked approved**.
4. Go back to the chat tab and click **I approved it, capture**. The card says **Paid with PayPal Goods & Services (sandbox)**.
5. Bonus: click the **Signe Kruse · camera** chat and press **Pay anyway**. PayBrake lets you and notes it on this device. The desk lamp chat further down the page is a normal chat and should stay quiet.

If you see a yellow box saying **PayBrake is not running in this browser**, the extension is not loaded. Repeat step 2 and reload the page.

## 4. Report a bug

Open **https://github.com/lamapony/paybrake/issues/new?template=bug_report.md** and fill in the short form. A screenshot helps most. Also handy: the PayBrake version shown on `chrome://extensions`.

## Updating to a newer test build

Download the new zip, unzip it over the old folder (or into a new one), then on `chrome://extensions` click the circular **Reload** arrow on the PayBrake card. If you used a new folder, remove the old PayBrake first and **Load unpacked** again.

---

### For developers

- The extension talks to the hosted mock server by default (`https://paybrake-demo.spbabinov.workers.dev`). To use a local backend, open the extension's **Settings** (right-click the icon > Options), click **Use localhost:8787**, then **Save**. Run `npm run dev:backend` and `npm run serve:demo`, and open `http://localhost:8080/demo/marketplace.html?live=1`.
- Build the zip: `npm run pack:extension` (writes `dist/paybrake-extension.zip`).
- Hosted demo and mock backend: one Cloudflare Worker in `hosted/` (static demo pages plus the mock API, orders kept in a Durable Object for 24 hours). PayPal in mock mode (no PayPal keys). The AI check runs on Typesafe (key stored as the Worker secret `TYPESAFE_API_KEY`), with a 2000-character cap, per-IP limits (20/min, 150/day), a global daily cap (2000/day) and a kill switch (`AI_KILL_SWITCH`); see README "Hosted demo limits". `npm run hosted:deploy` builds and deploys it (needs `npx wrangler login`). Pages and API send `X-Robots-Tag: noindex`, and `robots.txt` disallows everything.
- Tester end-to-end check (unzips the zip, loads it in Chromium, runs the steps above against the hosted URL, saves screenshots to `shots/tester/`): `npm run pack:extension && npm run e2e:hosted`.
