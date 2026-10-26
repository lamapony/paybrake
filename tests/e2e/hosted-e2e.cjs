// Hosted end-to-end: the tester path, nothing local.
// Unzips dist/paybrake-extension.zip, loads that folder in Chromium, and checks:
// install -> welcome tab -> "Try the demo store" -> hosted demo -> PayBrake card ->
// PayPal order -> mock approval -> capture. Screenshots at 1280 wide go to shots/tester-v2/ (PB_SHOTS overrides).
// Run: npm run pack:extension && npm run e2e:hosted
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync, execFileSync } = require("child_process");

let chromium;
try {
  ({ chromium } = require(process.env.PWC || "playwright-core"));
} catch {
  ({ chromium } = require("/home/box/.local/lib/node_modules/playwright-core"));
}

const root = path.resolve(__dirname, "..", "..");
const zip = path.join(root, "dist", "paybrake-extension.zip");
const shots = path.join(root, "shots", process.env.PB_SHOTS || "tester-v2");
const fallbackChrome = "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const origin = "https://paybrake-demo.spbabinov.workers.dev"; // must match extension/lib/config.js
const W = 1280;
const H = 900;

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (fs.existsSync(fallbackChrome)) return fallbackChrome;
  return undefined;
}

function unzipTo(dir) {
  try {
    execFileSync("unzip", ["-q", zip, "-d", dir]);
  } catch {
    execFileSync("python3", ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dir]);
  }
  const folder = path.join(dir, "paybrake-extension");
  if (!fs.existsSync(path.join(folder, "manifest.json"))) throw new Error("zip has no paybrake-extension/manifest.json");
  return folder;
}

async function shot(page, name) {
  const file = path.join(shots, name);
  await page.setViewportSize({ width: W, height: H });
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot " + path.relative(root, file));
}

async function run() {
  if (!fs.existsSync(zip)) throw new Error("run npm run pack:extension first");
  fs.mkdirSync(shots, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paybrake-tester-"));
  const extension = unzipTo(path.join(tmp, "unzipped"));
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
      headless: false,
      executablePath: chromePath(),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--headless=new"],
      viewport: { width: W, height: H }
    });
  } catch (error) {
    if (!process.env.PB_UNDER_XVFB && fs.existsSync("/usr/bin/xvfb-run")) {
      const again = spawnSync("xvfb-run", ["-a", process.execPath, __filename], {
        cwd: root, env: Object.assign({}, process.env, { PB_UNDER_XVFB: "1" }), stdio: "inherit"
      });
      process.exit(again.status == null ? 1 : again.status);
    }
    throw error;
  }

  try {
    // 1. Install -> welcome tab opens by itself.
    // Poll open pages: a new tab can report about:blank before it navigates.
    const isWelcome = (p) => /\/welcome\.html$/.test(p.url());
    let welcome = null;
    for (let i = 0; i < 150 && !welcome; i++) {
      welcome = context.pages().find(isWelcome) || null;
      if (!welcome) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!welcome) throw new Error("welcome tab did not open on install");
    await welcome.waitForLoadState("domcontentloaded");
    await welcome.getByRole("heading", { name: "You're all set" }).waitFor({ timeout: 5000 });
    const button = welcome.getByRole("link", { name: "Try the demo store" });
    await button.waitFor({ state: "visible", timeout: 5000 });
    const href = await button.getAttribute("href");
    if (href !== origin + "/demo/marketplace.html?live=1") throw new Error("demo button points at " + href);
    await shot(welcome, "01-welcome-1280.png");

    // 2. Big button -> hosted demo store in a new tab.
    const [store] = await Promise.all([context.waitForEvent("page"), button.click()]);
    await store.waitForLoadState("domcontentloaded");
    if (!store.url().startsWith(origin + "/demo/marketplace")) throw new Error("demo opened at " + store.url());

    // 3. PayBrake intervention on the bike chat.
    const card = store.locator("#thread-bike #pb-card");
    await card.waitFor({ state: "visible", timeout: 10000 });
    const text = await card.innerText();
    if (!/High risk/.test(text)) throw new Error("card did not say High risk: " + text.slice(0, 200));
    if (await store.locator("#pb-missing").count()) throw new Error("'not installed' hint shown while extension runs");
    const label = (await store.locator("#thread-bike #pb-protect").innerText()).trim();
    if (label !== "Switch to a PayPal order") throw new Error("protect button label is " + label);
    if (/protected/i.test(text)) throw new Error("card overclaims protection: " + text.slice(0, 200));
    await card.scrollIntoViewIfNeeded();
    await shot(store, "02-demo-intervention-1280.png");

    // 4. Switch to a PayPal order -> MOCK order from the hosted backend.
    await store.locator("#thread-bike #pb-protect").click();
    await store.locator("#thread-bike #pb-foot").getByText(/MOCK-/).waitFor({ timeout: 10000 });
    await shot(store, "03-paypal-order-1280.png");

    // 5. Open approval -> Approve (mock) on the hosted return page.
    const open = store.locator("#thread-bike").getByRole("link", { name: "Open approval" });
    const [approval] = await Promise.all([context.waitForEvent("page"), open.click()]);
    await approval.waitForLoadState("domcontentloaded");
    if (!approval.url().startsWith(origin + "/demo/checkout-return")) throw new Error("approval opened at " + approval.url());
    await approval.getByRole("button", { name: "Approve (mock)" }).click();
    await approval.getByText("Marked approved").waitFor({ timeout: 10000 });
    await shot(approval, "04-approval-1280.png");

    // 6. Back in the chat: capture -> paid.
    await store.bringToFront();
    await store.locator("#thread-bike #pb-capture").click();
    await store.locator("#thread-bike").getByText(/Paid with PayPal Goods & Services \(sandbox\)/).waitFor({ timeout: 10000 });
    await shot(store, "05-captured-1280.png");

    console.log("hosted tester e2e passed against " + origin);
  } finally {
    if (context) await context.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
