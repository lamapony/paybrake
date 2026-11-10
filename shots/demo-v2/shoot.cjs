// Demo-v2 screenshots: node shots/demo-v2/shoot.cjs <base-url> <before|after>
// Uses CHROME_PATH, else the macOS Playwright cache, else Playwright's default.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-core");

const base = (process.argv[2] || "http://localhost:8080").replace(/\/$/, "");
const tag = process.argv[3] || "after";
const out = __dirname;
const macChrome = path.join(process.env.HOME || "", "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const exe = process.env.CHROME_PATH || (fs.existsSync(macChrome) ? macChrome : undefined);
const home = process.env.HOME_PATH || "/";

const report = [];
async function visit(browser, name, url, width, height, act) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(url.includes("live=1") ? 3000 : 600);
  if (act) await act(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const file = `${tag}-${name}.jpg`;
  await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 70, fullPage: true });
  report.push({ file, url, width, overflow, errors });
  await page.close();
}

(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    const jobs = tag === "before" ? [
      ["home-1280", home, 1280, 800], ["home-390", home, 390, 844],
      ["market-1280", "/demo/marketplace.html", 1280, 800], ["market-390", "/demo/marketplace.html", 390, 844],
      ["live-1280", "/demo/marketplace.html?live=1", 1280, 800], ["live-390", "/demo/marketplace.html?live=1", 390, 844],
      ["promo-1280", "/promo/", 1280, 800]
    ] : [
      ["home-1280", home, 1280, 800], ["home-390", home, 390, 844],
      ["market-1280", "/demo/marketplace.html", 1280, 800], ["market-390", "/demo/marketplace.html", 390, 844],
      ["protect-1280", "/demo/marketplace.html", 1280, 800, async (p) => { await p.click("#pb-protect"); await p.waitForTimeout(400); }],
      ["protect-390", "/demo/marketplace.html", 390, 844, async (p) => { await p.click("#pb-protect"); await p.waitForTimeout(400); }],
      ["camera-1280", "/demo/marketplace.html", 1280, 800, async (p) => { await p.click("#pb-show-thread-2"); await p.waitForTimeout(300); }],
      ["lamp-1280", "/demo/marketplace.html", 1280, 800, async (p) => { await p.click("#pb-show-thread-5"); await p.waitForTimeout(300); }],
      ["lamp-390", "/demo/marketplace.html", 390, 844, async (p) => { await p.click("#pb-show-thread-5"); await p.waitForTimeout(300); }],
      ["anyway-390", "/demo/marketplace.html", 390, 844, async (p) => { await p.click("#pb-anyway"); await p.waitForTimeout(300); }],
      ["live-1280", "/demo/marketplace.html?live=1", 1280, 800]
    ];
    for (const [name, url, w, h, act] of jobs) {
      if (only && !only.includes(name)) continue;
      await visit(browser, name, url, w, h, act);
    }
  } finally {
    await browser.close();
  }
  for (const r of report) console.log(`${r.file}  overflow=${r.overflow}px  errors=${r.errors.length ? JSON.stringify(r.errors) : 0}`);
})().catch((e) => { console.error(e); process.exit(1); });
