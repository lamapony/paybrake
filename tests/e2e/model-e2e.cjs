// On-device model e2e. Loads the unpacked MV3 extension in Chromium, checks that the
// service worker decoded the model weights, that a chat the rules miss gets an
// "On-device model" card, that a safe chat stays quiet, and that turning the model
// off in the options falls back to rules (no card).
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
  await waitFor(origin + "/demo/model-chats.html");
  await waitFor("http://127.0.0.1:8787/health");

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "paybrake-model-"));
  let context;
  try {
    context = await launchContext(userData);
  } catch (error) {
    skip(error && error.message ? error.message : String(error));
  }

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
    const extensionId = new URL(worker.url()).host;
    const info = await worker.evaluate(() => globalThis.pbScamModel && globalThis.pbScamModel.info());
    if (!info || !info.version) throw new Error("service worker did not load the on-device model");
    console.log("service worker model", info.version, "threshold", info.threshold);
    // Local mock server: no AI provider, so any card on these chats comes from the rules or the model.
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ pb_opts: { backendUrl: "http://localhost:8787", aiAll: true, debug: false } });
    });

    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + "/demo/model-chats.html", { waitUntil: "domcontentloaded" });
    const flagged = [];
    for (const id of ["#thread-prize", "#thread-mor"]) {
      const card = page.locator(id + " #pb-card");
      await card.waitFor({ state: "visible", timeout: 6000 });
      const text = await card.innerText();
      if (!/On-device model/.test(text)) throw new Error(id + ": card is not marked On-device model: " + text);
      if (!/Account safety|Possible scam|risk/i.test(text)) throw new Error(id + ": unexpected card: " + text);
      // No amount was named, so the model card must not offer a PayPal order.
      if (/Switch to a PayPal order/.test(text)) throw new Error(id + ": model card without an amount offered a PayPal order");
      console.log(id, JSON.stringify(text.split("\n").filter(Boolean).slice(0, 4).join(" | ")));
      flagged.push(id);
    }
    await page.waitForTimeout(2500);
    if (await page.locator("#thread-safe #pb-card").count()) throw new Error("safe chat got a card");
    if (await page.locator("#thread-safe-da #pb-card").count()) throw new Error("safe Danish chat got a card");
    await page.screenshot({ path: path.join(shots, "model-1280.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(shots, "model-390.png"), fullPage: true });

    const options = await context.newPage();
    await options.setViewportSize({ width: 900, height: 1100 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator("#localModel").waitFor({ timeout: 5000 });
    if (!(await options.locator("#localModel").isChecked())) throw new Error("model should default on");
    await options.locator("#localModel").scrollIntoViewIfNeeded();
    await options.screenshot({ path: path.join(shots, "model-options.png"), fullPage: true });
    await options.locator("#localModel").uncheck();
    await options.locator("#save").click();
    await options.locator("#saved").getByText("Saved").waitFor({ timeout: 3000 });

    // Model off: rules only, so the chats the rules miss stay quiet.
    const again = await context.newPage();
    await again.setViewportSize({ width: 1280, height: 900 });
    await again.goto(origin + "/demo/model-chats.html", { waitUntil: "domcontentloaded" });
    await again.waitForTimeout(3500);
    for (const id of flagged) {
      if (await again.locator(id + " #pb-card").count()) throw new Error(id + ": card shown with the model off");
    }
    console.log("model e2e passed: " + flagged.join(", ") + " flagged, safe chats quiet, model-off falls back to rules");
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
