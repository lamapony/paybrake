// Demo + mock pass for the round-2 chat bugs. Uses the in-page shim, which
// stores the order on this origin the same way the extension stores it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoPort = 8080;
const apiPort = 8787;
const origin = `http://localhost:${demoPort}`;
const backend = `http://127.0.0.1:${apiPort}`;
const libs = [
  "extension/lib/brand.js",
  "extension/lib/tidy.js",
  "extension/lib/atoms.js",
  "extension/lib/extract.js",
  "extension/lib/redact.js",
  "extension/lib/pay-risk.js",
  "extension/lib/ask-llm.js",
  "extension/lib/chat-state.js",
  "extension/content.js"
];

function spawnNode(script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: Object.assign({ PATH: process.env.PATH || "", HOME: process.env.HOME || "" }, env),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (buf) => process.stdout.write(buf));
  child.stderr.on("data", (buf) => process.stderr.write(buf));
  return child;
}

function stop(child) {
  if (child && child.exitCode == null && child.pid) {
    try { process.kill(child.pid, "SIGTERM"); } catch { /* already gone */ }
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

async function inject(page) {
  await page.evaluate((url) => { window.__pbBackend = url; }, backend);
  for (const file of libs) {
    await page.addScriptTag({ path: path.join(root, file) });
  }
}

test("qa r2 demo and mock: order, typos, advice, pay anyway", {
  timeout: 120000,
  skip: process.env.CHROME_PATH ? false : "Set CHROME_PATH to run the browser pass"
}, async () => {
  const { chromium } = await import("playwright-core");
  const chrome = process.env.CHROME_PATH;
  const demo = spawnNode("scripts/serve.mjs", { PORT: String(demoPort) });
  const api = spawnNode("backend/src/server.js", {
    PORT: String(apiPort),
    PAYPAL_ENV: "sandbox",
    PAYPAL_ADAPTER: "mock",
    PAYPAL_CLIENT_ID: "",
    LLM_BASE_URL: "",
    ALLOWED_ORIGINS: `${origin},http://127.0.0.1:${demoPort}`
  });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await waitFor(origin + "/demo/marketplace.html?live=1");
    await waitFor(backend + "/health");
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    await page.goto(origin + "/demo/marketplace.html?live=1");
    await page.evaluate(() => {
      // The bike thread has three seller lines; blank every one so the real ask does not leak in.
      const sellers = document.querySelectorAll("#thread-bike [data-pb-msg][data-from='seller']");
      sellers.forEach((node) => { node.textContent = "Hello."; });
      sellers[0].textContent = "Send 500 kr deposiit via PayPal frends and famliy now, I ship tomorrow.";
    });
    await inject(page);
    const typoCard = page.locator("#thread-bike #pb-card");
    await typoCard.waitFor({ state: "visible", timeout: 8000 });
    const typoText = await typoCard.innerText();
    assert.match(typoText, /risk/i);
    assert.match(typoText, /Friends & Family/);
    assert.match(typoText, /Upfront deposit/);

    await page.goto(origin + "/demo/marketplace.html?live=1");
    await page.evaluate(() => {
      const sellers = document.querySelectorAll("#thread-bike [data-pb-msg][data-from='seller']");
      sellers.forEach((node) => { node.textContent = "Hello."; });
      sellers[1].textContent = "Never send a deposit via PayPal Friends & Family. Beware of scams.";
    });
    await inject(page);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#thread-bike [data-pb-host]").count(), 0);

    await page.goto(origin + "/demo/marketplace.html?live=1");
    await inject(page);
    const bike = page.locator("#thread-bike #pb-card");
    await bike.waitFor({ state: "visible", timeout: 8000 });
    await page.locator("#thread-bike #pb-protect").click();
    await page.locator("#thread-bike #pb-foot").getByText(/MOCK-/).waitFor({ timeout: 8000 });
    const orderText = await page.locator("#thread-bike #pb-foot").innerText();
    const orderId = orderText.match(/MOCK-[0-9a-f-]+/i)[0];

    await page.locator("#pb-show-thread-2").click();
    await page.locator("#thread-camera #pb-anyway").click();
    await page.locator("#thread-camera").getByText("You chose to pay anyway. Logged on this device.").waitFor({ timeout: 5000 });

    await page.reload();
    await inject(page);
    await page.locator("#thread-bike #pb-foot").getByText(orderId).waitFor({ timeout: 8000 });
    assert.equal(await page.locator("#thread-bike #pb-protect").count(), 0);
    assert.equal(await page.locator("#thread-bike #pb-capture").count(), 1);

    await page.locator("#pb-show-thread-2").click();
    await page.locator("#thread-camera").getByText("You chose to pay anyway. Logged on this device.").waitFor({ timeout: 8000 });
    assert.equal(await page.locator("#thread-camera #pb-anyway").count(), 0);

    const popupPromise = page.waitForEvent("popup");
    await page.locator("#pb-show-thread-1").click();
    await page.locator("#thread-bike #pb-foot").getByText(orderId).waitFor({ timeout: 8000 });
    await page.locator("#thread-bike a", { hasText: "Open approval" }).click();
    const popup = await popupPromise;
    await popup.locator("#approve").click();
    await popup.locator("#status").getByText("Marked approved").waitFor({ timeout: 8000 });
    await popup.locator("a.back").click();
    await popup.waitForURL(/marketplace\.html\?live=1/);
    await inject(popup);
    await popup.locator("#thread-bike #pb-foot").getByText(orderId).waitFor({ timeout: 8000 });
    await popup.locator("#thread-bike").getByText("Approval received.").waitFor({ timeout: 8000 });
    assert.equal(await popup.locator("#thread-bike #pb-capture").count(), 1);
    await page.close();
  } finally {
    await browser.close();
    stop(demo);
    stop(api);
  }
});
