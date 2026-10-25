// Screenshots + sanity checks for demo/marketplace.html.
// Usage: PWC=/path/to/playwright-core node scripts/shot-demo.cjs
const path = require("path");
const fs = require("fs");
const { chromium } = require(process.env.PWC || "playwright-core");

const root = path.resolve(__dirname, "..");
const url = "file://" + path.join(root, "demo", "marketplace.html");
const outDir = path.join(root, "shots");
const failures = [];

function check(cond, msg) {
  if (!cond) failures.push(msg);
  console.log((cond ? "ok   " : "FAIL ") + msg);
}

async function textChecks(page, label) {
  const text = await page.evaluate(() => document.body.innerText);
  check(text.includes("may be eligible"), `${label}: page text contains "may be eligible"`);
  for (const bad of ["guaranteed", "Facebook", "Meta"]) {
    check(!text.includes(bad), `${label}: page text does not contain "${bad}"`);
  }
}

async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: no horizontal overflow (${overflow}px)`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
  });
  const requests = [];

  try {
    const sizes = [
      { w: 1280, h: 800, dpr: 1 },
      { w: 390, h: 844, dpr: 2 },
    ];
    for (const { w, h, dpr } of sizes) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      page.on("request", (r) => { if (!r.url().startsWith("file://")) requests.push(r.url()); });
      await page.goto(url);
      const label = `${w}px`;
      check(await page.locator("#pb-card").isVisible(), `${label}: #pb-card is visible`);
      check((await page.getAttribute("#pb-card", "data-pb-risk")) === "high", `${label}: #pb-card data-pb-risk="high"`);
      await textChecks(page, label);
      await noHorizontalOverflow(page, label);

      if (w === 390) {
        for (const id of ["#pb-protect", "#pb-anyway"]) {
          const box = await page.locator(id).boundingBox();
          const card = await page.locator("#pb-card .actions").boundingBox();
          check(box && box.height >= 44, `${label}: ${id} is at least 44px tall (${box && box.height})`);
          check(box && Math.abs(box.width - card.width) < 1, `${label}: ${id} is full width`);
        }
      }

      await page.screenshot({ path: path.join(outDir, `demo-${w}.png`), fullPage: true });

      if (w === 1280) {
        await page.click("#pb-protect");
        const foot = await page.locator("#pb-foot").innerText();
        check(foot.includes("Sandbox order created") && foot.includes("5O190127TN364715T"), `${label}: protect click shows sandbox order status`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outDir, "demo-1280-protect.png"), fullPage: true });

        await page.reload();
        await page.click("#pb-anyway");
        const card = await page.locator("#pb-card").innerText();
        check(card.trim() === "You chose to pay anyway. Logged on this device.", `${label}: pay-anyway collapses the card`);
      }
      await page.close();
    }
    check(requests.length === 0, `no network requests (${requests.join(", ") || "none"})`);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
