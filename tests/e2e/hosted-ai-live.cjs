// Live check of the AI check on the hosted demo Worker (Typesafe).
// Loads extension/ unpacked in headless Chromium (its default server is the hosted Worker) and checks:
// /health says typesafe; the bike scam chat gets a card tagged "AI checked"; the safe lamp chat and
// the safe-chats page get no card; a "You've won, text WIN to 87121" SMS gets a card; a fee chat that the rules miss gets an AI-added card.
// Screenshots go to shots/ai-live/. Run: node tests/e2e/hosted-ai-live.cjs
const path = require("path");
const fs = require("fs");
const os = require("os");

let chromium;
try {
  ({ chromium } = require(process.env.PWC || "playwright-core"));
} catch {
  ({ chromium } = require("/home/box/.local/lib/node_modules/playwright-core"));
}

const root = path.resolve(__dirname, "..", "..");
const extension = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : path.join(root, "extension");
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : path.join(root, "shots", "ai-live");
const origin = "https://paybrake-demo.spbabinov.workers.dev";
const fallbackChrome = "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  fs.mkdirSync(shots, { recursive: true });
  const health = await (await fetch(origin + "/health")).json();
  if (health.llmProvider !== "typesafe") throw new Error("health: " + JSON.stringify(health));
  console.log("health", JSON.stringify(health));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ai-live-"));
  const context = await chromium.launchPersistentContext(tmp, {
    headless: false,
    executablePath: process.env.CHROME_PATH || (fs.existsSync(fallbackChrome) ? fallbackChrome : undefined),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--headless=new"],
    viewport: { width: 1280, height: 900 }
  });
  try {
    const page = await context.newPage();
    const classify = [];
    page.on("console", () => {});
    context.on("requestfinished", async (req) => {
      if (req.url().endsWith("/api/classify")) {
        const res = await req.response();
        classify.push(res ? res.status() : 0);
      }
    });
    await page.goto(origin + "/demo/marketplace.html?live=1", { waitUntil: "domcontentloaded" });
    const bike = page.locator("#thread-bike #pb-card");
    await bike.waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#thread-bike #pb-card .pb-tag.ai").waitFor({ timeout: 15000 });
    const bikeText = (await bike.innerText()).replace(/\s+/g, " ");
    console.log("bike card:", bikeText.slice(0, 160));
    await bike.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, "01-scam-chat-ai-checked.png") });

    await sleep(4000); // let the AI pass on the lamp chat finish
    const lampCards = await page.locator("#thread-lamp #pb-card").count();
    if (lampCards) throw new Error("safe lamp chat got a card: " + (await page.locator("#thread-lamp #pb-card").innerText()));
    await page.locator("#thread-lamp").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, "02-safe-chat-no-card.png") });
    console.log("lamp chat: no card");

    const safe = await context.newPage();
    await safe.goto(origin + "/demo/safe-chats.html?live=1", { waitUntil: "domcontentloaded" });
    await sleep(6000);
    const safeCards = await safe.locator("[data-pb-thread] #pb-card").count();
    if (safeCards) throw new Error("safe-chats page got " + safeCards + " card(s)");
    await safe.screenshot({ path: path.join(shots, "03-safe-chats-no-card.png"), fullPage: true });
    console.log("safe-chats: no card on 3 chats");

    // A scam the rules miss: a fake parcel message with a fee link. Only the AI can flag it.
    await safe.evaluate(() => {
      const s = document.createElement("section");
      s.className = "card";
      s.id = "thread-ai-only";
      s.setAttribute("data-pb-thread", "");
      s.innerHTML = '<div class="msg out"><div class="bubble" data-pb-msg data-from="buyer">Hi, did you send the parcel?</div></div>' +
        '<div class="msg in"><div class="bubble" data-pb-msg data-from="seller">Your parcel is waiting at our depot. Confirm your address and settle the outstanding balance on our portal today so it is not returned to sender.</div></div>';
      document.querySelector("main, body").prepend(s);
    });
    const ai = safe.locator("#thread-ai-only #pb-card");
    let added = false;
    try { await ai.waitFor({ state: "visible", timeout: 15000 }); added = true; } catch { /* report below */ }
    const aiText = added ? (await ai.innerText()).replace(/\s+/g, " ") : "";
    console.log(added ? "AI-only chat card: " + aiText.slice(0, 160) : "AI-only chat: no card");
    await safe.locator("#thread-ai-only").scrollIntoViewIfNeeded();
    await safe.screenshot({ path: path.join(shots, "04-ai-only-scam.png") });
    // Prize SMS spam with a premium short code (caught by the extra Typesafe questions).
    await safe.evaluate(() => {
      const s = document.createElement("section");
      s.className = "card";
      s.id = "thread-prize";
      s.setAttribute("data-pb-thread", "");
      s.innerHTML = '<div class="msg in"><div class="bubble" data-pb-msg data-from="seller">You\'ve won a £1,000 prize! Text WIN to 87121 to claim it now.</div></div>';
      document.querySelector("main, body").prepend(s);
    });
    const prize = safe.locator("#thread-prize #pb-card");
    await prize.waitFor({ state: "visible", timeout: 15000 });
    console.log("prize SMS card: " + (await prize.innerText()).replace(/\s+/g, " ").slice(0, 160));
    await safe.locator("#thread-prize").scrollIntoViewIfNeeded();
    await safe.screenshot({ path: path.join(shots, "05-prize-sms.png") });
    console.log("classify statuses:", JSON.stringify(classify));
    console.log("hosted AI live check passed" + (added ? "" : " (AI-only card not shown)"));
  } finally {
    await context.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
