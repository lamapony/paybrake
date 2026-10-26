// Extension smoke. Loads the unpacked MV3 extension in Chromium.
// If the browser cannot load an extension here, print SKIP and exit 0.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

let chromium;
try {
  ({ chromium } = require(process.env.PWC || "playwright-core"));
} catch {
  ({ chromium } = require("/home/box/.local/lib/node_modules/playwright-core"));
}

const root = path.resolve(__dirname, "..", "..");
const extension = path.join(root, "extension");
const shots = path.join(root, "shots");
const fallbackChrome = "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const children = [];

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (fs.existsSync(fallbackChrome)) return fallbackChrome;
  return undefined;
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
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for " + url);
}

function skip(reason) {
  console.log("SKIP extension smoke: " + reason);
  stopChildren();
  process.exit(0);
}

async function launchContext(userData) {
  const executablePath = chromePath();
  const args = [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--headless=new"
  ];
  return chromium.launchPersistentContext(userData, {
    headless: false,
    executablePath,
    args,
    viewport: { width: 1280, height: 800 }
  });
}

async function run() {
  fs.mkdirSync(shots, { recursive: true });
  const origin = "http://127.0.0.1:8080";
  spawnNode("scripts/serve.mjs", { PORT: "8080" });
  spawnNode("backend/src/server.js", {
    PORT: "8787",
    PAYPAL_ENV: "sandbox",
    PAYPAL_ADAPTER: "mock",
    PAYPAL_CLIENT_ID: "",
    LLM_BASE_URL: "",
    ALLOWED_ORIGINS: origin + ",http://localhost:8080"
  });
  await waitFor(origin + "/demo/marketplace.html?live=1");
  await waitFor("http://127.0.0.1:8787/health");
  await waitFor("http://localhost:8787/health");

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "paybrake-ext-"));
  let context;
  try {
    context = await launchContext(userData);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!process.env.PB_UNDER_XVFB && fs.existsSync("/usr/bin/xvfb-run")) {
      stopChildren();
      const again = spawnSync("xvfb-run", ["-a", process.execPath, __filename], {
        cwd: root,
        env: Object.assign({}, process.env, { PB_UNDER_XVFB: "1" }),
        stdio: "inherit"
      });
      process.exit(again.status == null ? 1 : again.status);
    }
    skip(message);
  }

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
    const extensionId = new URL(worker.url()).host;
    // The extension defaults to the hosted test server; this smoke runs local servers.
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ pb_opts: { backendUrl: "http://localhost:8787", llm: false, debug: false } });
    });

    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(origin + "/demo/marketplace.html?live=1", { waitUntil: "domcontentloaded" });
    const card = page.locator("#thread-bike #pb-card");
    await card.waitFor({ state: "visible", timeout: 5000 });
    const text = await card.innerText();
    if (!text.includes("High risk")) throw new Error("live card did not say High risk");
    await page.screenshot({ path: path.join(shots, "ext-live-1280.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(shots, "ext-live-390.png"), fullPage: true });
    const protectBox = await page.locator("#thread-bike #pb-protect").boundingBox();
    if (!protectBox || protectBox.height < 44) throw new Error("protect button shorter than 44px at 390");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator("#thread-bike #pb-protect").click();
    await page.locator("#thread-bike #pb-foot").getByText(/MOCK-/).waitFor({ timeout: 5000 });

    await page.locator("#pb-show-thread-2").click();
    const anyway = page.locator("#thread-camera #pb-anyway");
    await anyway.waitFor({ state: "visible", timeout: 5000 });
    await anyway.click();
    await page.locator("#thread-camera").getByText("You chose to pay anyway. Logged on this device.").waitFor({ timeout: 5000 });

    let sawOverride = false;
    for (let i = 0; i < 20; i++) {
      const log = await worker.evaluate(async () => {
        const stored = await chrome.storage.local.get("pb_log");
        return stored.pb_log || [];
      });
      if (log.some((entry) => entry && entry.action === "override")) {
        sawOverride = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!sawOverride) throw new Error("override was not written to the ring log");

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator("#log").waitFor({ timeout: 5000 });
    const shown = await options.locator("#log").innerText();
    if (!/override/i.test(shown)) throw new Error("options page did not show the override");
    console.log("extension smoke passed");
  } finally {
    if (context) await context.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  stopChildren();
});
