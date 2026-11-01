// Screenshots + sanity checks for the static demo and the injected live card.
// Usage: node scripts/shot-demo.cjs
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let chromium;
try {
  ({ chromium } = require(process.env.PWC || "playwright-core"));
} catch {
  ({ chromium } = require("/home/box/.local/lib/node_modules/playwright-core"));
}

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "shots");
const fallbackChrome = "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const failures = [];
const children = [];

function check(cond, msg) {
  if (!cond) failures.push(msg);
  console.log((cond ? "ok   " : "FAIL ") + msg);
}

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (fs.existsSync(fallbackChrome)) return fallbackChrome;
  return undefined;
}

function launchOptions() {
  const executablePath = chromePath();
  return executablePath ? { executablePath } : {};
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

function spawnNode(script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: Object.assign({
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || ""
    }, env),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (buf) => process.stdout.write(buf));
  child.stderr.on("data", (buf) => process.stderr.write(buf));
  children.push(child);
  return child;
}

function stopChildren() {
  for (const child of children) {
    if (child.exitCode == null && child.pid) {
      try { process.kill(child.pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
}

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for " + url);
}

async function staticPass(browser) {
  const requests = [];
  const market = "file://" + path.join(root, "demo", "marketplace.html");
  const sizes = [
    { w: 1280, h: 800, dpr: 1 },
    { w: 390, h: 844, dpr: 2 }
  ];
  for (const { w, h, dpr } of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    page.on("request", (req) => {
      if (!req.url().startsWith("file://")) requests.push(req.url());
    });
    await page.goto(market);
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
        check(box && card && Math.abs(box.width - card.width) < 1, `${label}: ${id} is full width`);
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

  const safe = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  safe.on("request", (req) => {
    if (!req.url().startsWith("file://")) requests.push(req.url());
  });
  await safe.goto("file://" + path.join(root, "demo", "safe-chats.html"));
  check((await safe.locator("#pb-card").count()) === 0, "safe: no #pb-card");
  const safeText = await safe.evaluate(() => document.body.innerText);
  check(!safeText.includes("High risk"), "safe: page text has no High risk card");
  await noHorizontalOverflow(safe, "safe 1280");
  await safe.screenshot({ path: path.join(outDir, "safe-1280.png"), fullPage: true });
  await safe.close();

  check(requests.length === 0, `no network requests (${requests.join(", ") || "none"})`);
}

async function livePass(browser) {
  const demoPort = 8080;
  const apiPort = 8787;
  const origin = `http://127.0.0.1:${demoPort}`;
  const backend = `http://127.0.0.1:${apiPort}`;
  spawnNode("scripts/serve.mjs", { PORT: String(demoPort) });
  spawnNode("backend/src/server.js", {
    PORT: String(apiPort),
    PAYPAL_ENV: "sandbox",
    PAYPAL_ADAPTER: "mock",
    PAYPAL_CLIENT_ID: "",
    LLM_BASE_URL: "",
    ALLOWED_ORIGINS: `${origin},http://localhost:${demoPort}`
  });
  await waitFor(origin + "/demo/marketplace.html?live=1");
  await waitFor(backend + "/health");

  const libs = [
    "extension/lib/brand.js",
    "extension/lib/tidy.js",
    "extension/lib/atoms.js",
    "extension/lib/extract.js",
    "extension/lib/tiny-judge.js",
    "extension/lib/pay-risk.js",
    "extension/lib/ask-llm.js",
    "extension/content.js"
  ];

  async function openLive(w, h, dpr) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await page.goto(origin + "/demo/marketplace.html?live=1");
    await page.evaluate((url) => { window.__pbBackend = url; }, backend);
    for (const file of libs) {
      await page.addScriptTag({ path: path.join(root, file) });
    }
    const card = page.locator("#pb-card");
    await card.waitFor({ state: "visible", timeout: 5000 });
    return page;
  }

  const wide = await openLive(1280, 800, 1);
  const wideText = await wide.locator("#pb-card").innerText();
  check(wideText.includes("High risk"), "live 1280: card says High risk");
  check((await wide.locator("[data-pb-host]").count()) === 1, "live 1280: one card host");
  await noHorizontalOverflow(wide, "live 1280");
  await wide.screenshot({ path: path.join(outDir, "live-1280.png"), fullPage: true });
  await wide.locator("#pb-protect").click();
  await wide.locator("#pb-foot").getByText(/MOCK-/).waitFor({ timeout: 5000 });
  const orderText = await wide.locator("#pb-card").innerText();
  check(orderText.includes("Sandbox order created") && orderText.includes("MOCK-"), "live 1280: protect shows a MOCK id");
  await wide.screenshot({ path: path.join(outDir, "live-1280-order.png"), fullPage: true });
  await wide.close();

  const phone = await openLive(390, 844, 2);
  const phoneText = await phone.locator("#pb-card").innerText();
  check(phoneText.includes("High risk"), "live 390: card says High risk");
  for (const id of ["#pb-protect", "#pb-anyway"]) {
    const box = await phone.locator(id).boundingBox();
    check(box && box.height >= 44, `live 390: ${id} is at least 44px tall (${box && box.height})`);
  }
  await noHorizontalOverflow(phone, "live 390");
  const safeCount = await phone.locator("#thread-lamp [data-pb-host]").count();
  check(safeCount === 0, "live 390: lamp chat has no card");
  await phone.screenshot({ path: path.join(outDir, "live-390.png"), fullPage: true });
  await phone.close();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch(launchOptions());
  try {
    await staticPass(browser);
    await livePass(browser);
  } finally {
    await browser.close();
    stopChildren();
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
})().catch((err) => {
  stopChildren();
  console.error(err);
  process.exit(1);
});
