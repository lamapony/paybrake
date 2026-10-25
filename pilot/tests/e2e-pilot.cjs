// End-to-end pilot check: loads the unpacked extension in Chromium and serves
// fixtures/messenger-thread.html at real chat URLs via route interception (no network,
// no login), so the manifest match patterns are exercised for real.
// Run: node tests/e2e-pilot.cjs   (PWC=/path/to/playwright-core to override)
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require(process.env.PWC || "/home/box/.local/lib/node_modules/playwright-core");

const pilot = path.resolve(__dirname, "..");
const ext = path.join(pilot, "extension");
const fixture = fs.readFileSync(path.join(pilot, "fixtures", "messenger-thread.html"), "utf8");
const shots = path.resolve(pilot, "..", "shots");
const CHROME = process.env.CHROME || "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log((cond ? "ok   " : "FAIL ") + msg); };
const CARD = '[data-paybrake="card"]';

const SCAM = [
  "Several people are interested so it has to be quick 🙂",
  "Price is 1800 kr but send 500 kr deposit via PayPal Friends & Family today and I hold it for you. Only shipping, I'm in Aarhus",
];

async function cardCount(page) { return page.locator(CARD).count(); }
async function waitCard(page, ms = 5000) {
  try { await page.locator(CARD).first().waitFor({ state: "attached", timeout: ms }); return true; } catch { return false; }
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pb-pilot-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const external = [];
  await ctx.route(/^https:\/\/(www\.facebook\.com|www\.messenger\.com)\//, (r) => {
    if (r.request().resourceType() === "document") return r.fulfill({ contentType: "text/html; charset=utf-8", body: fixture });
    external.push(r.request().url());
    return r.abort();
  });
  const pageErrors = [];
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
    const extId = new URL(sw.url()).host;
    check(Boolean(extId), `extension service worker running (${extId})`);

    // 1) Scam thread on /messages/t/
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto("https://www.facebook.com/messages/t/100000000000001/");
    await page.waitForFunction(() => document.documentElement.dataset.paybrake === "on", null, { timeout: 5000 }).catch(() => {});
    check(await page.evaluate(() => document.documentElement.dataset.paybrake === "on"), "content script active on /messages/t/");
    await page.waitForTimeout(1500);
    check((await cardCount(page)) === 0, "silent on the normal opening messages");

    await page.evaluate((t) => window.fixture.addOutgoing(t), "Can I send you 500 kr deposit with Friends & Family?");
    await page.waitForTimeout(1500);
    check((await cardCount(page)) === 0, "silent on my own (outgoing) risky-looking message");

    await page.evaluate((t) => window.fixture.addIncoming(t), SCAM[0]);
    await page.waitForTimeout(1200);
    check((await cardCount(page)) === 0, "urgency alone stays silent");

    await page.evaluate((t) => window.fixture.addIncoming(t), SCAM[1]);
    check(await waitCard(page), "risk card appears within 5 s of the scam message");
    check((await cardCount(page)) === 1, "exactly one card");
    const placed = await page.evaluate((sel) => {
      const host = document.querySelector(sel);
      const row = host && host.closest('[role="row"]');
      return Boolean(row && row.textContent.includes("Friends & Family"));
    }, CARD);
    check(placed, "card is inside the row of the flagged message");
    const card = page.locator(CARD).first();
    const cardText = await card.innerText();
    check(/High risk payment request/.test(cardText), "badge says High risk payment request");
    check(/Friends & Family|deposit/i.test(cardText), "reason quotes the evidence");
    check(!/guarantee|you are protected|100% safe/i.test(cardText), "no guarantee language in card");
    check(await card.locator('[data-pb-action="protect"]').isVisible(), "protect button visible");
    check(await card.locator('[data-pb-action="anyway"]').isVisible(), "pay anyway button visible");
    check((await page.evaluate(() => window.fixture.composerText())) === "", "composer untouched");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, "pilot-1280.png") });

    // 2) Re-render: card must come back once, not duplicate
    await page.evaluate(() => window.fixture.rerender());
    await page.waitForTimeout(2500);
    check((await cardCount(page)) === 1, "after a re-render the card is re-attached exactly once");

    // 3) Protect -> extension order page
    const [order] = await Promise.all([
      ctx.waitForEvent("page", { timeout: 5000 }),
      page.locator(CARD).first().locator('[data-pb-action="protect"]').click(),
    ]);
    await order.waitForLoadState("domcontentloaded");
    check(order.url().startsWith(`chrome-extension://${extId}/order.html`), `order page opened (${order.url().slice(0, 80)})`);
    const orderText = await order.locator("body").innerText();
    check(/may be eligible/.test(orderText), "order page says Buyer Protection may be eligible");
    check(!/guarantee|you are protected|100% safe/i.test(orderText), "order page has no guarantee language");
    check(/500/.test(await order.locator("#order-amount").innerText()), "order amount parsed from chat (500)");
    check(/Used road bike/.test(orderText), "order item taken from the thread title");
    await order.setViewportSize({ width: 1280, height: 800 });
    await order.screenshot({ path: path.join(shots, "pilot-order-1280.png"), fullPage: true });
    const create = order.locator("#order-create");
    if (await create.count()) {
      await create.click();
      await order.waitForTimeout(500);
      check(/MOCK-/.test(await order.locator("body").innerText()), "mock sandbox order id shown");
      await order.screenshot({ path: path.join(shots, "pilot-order-created-1280.png"), fullPage: true });
    } else check(false, "#order-create button exists");
    await order.close();

    // 4) Pay anyway -> collapse + log
    await page.locator(CARD).first().locator('[data-pb-action="anyway"]').click();
    await page.waitForTimeout(500);
    check(/pay anyway/i.test(await page.locator(CARD).first().innerText()), "card collapses after Pay anyway");
    const log = await sw.evaluate(() => chrome.storage.local.get("pb_log").then((r) => r.pb_log || []));
    check(Array.isArray(log) && log.some((e) => e.action === "pay_anyway"), `override logged in chrome.storage (${log.length})`);
    await page.screenshot({ path: path.join(shots, "pilot-anyway-1280.png") });

    // 5) 390 px mobile width
    const m = await ctx.newPage();
    m.on("pageerror", (e) => pageErrors.push(String(e)));
    await m.setViewportSize({ width: 390, height: 844 });
    await m.goto("https://www.messenger.com/t/100000000000002/");
    await m.waitForTimeout(1000);
    await m.evaluate((t) => window.fixture.addIncoming(t), "Kan du sende 500 kr i depositum på MobilePay i dag? Mange er interesserede");
    check(await waitCard(m), "390: card appears on messenger.com (Danish)");
    const c390 = m.locator(CARD).first();
    for (const a of ["protect", "anyway"]) {
      const b = await c390.locator(`[data-pb-action="${a}"]`).boundingBox();
      check(b && b.height >= 44, `390: ${a} button >= 44 px tall (${b && b.height})`);
      check(b && b.x >= 0 && b.x + b.width <= 390, `390: ${a} button inside viewport`);
    }
    await c390.scrollIntoViewIfNeeded();
    await m.screenshot({ path: path.join(shots, "pilot-390.png") });
    await m.close();

    // 6) Safe thread on /marketplace/ stays silent
    const s = await ctx.newPage();
    s.on("pageerror", (e) => pageErrors.push(String(e)));
    await s.goto("https://www.facebook.com/marketplace/t/100000000000003/?thread=safe");
    await s.waitForTimeout(3000);
    check(await s.evaluate(() => document.documentElement.dataset.paybrake === "on"), "content script active on /marketplace/");
    check((await cardCount(s)) === 0, "safe chat (MobilePay on pickup, friends and family loved it) stays silent");
    await s.screenshot({ path: path.join(shots, "pilot-safe-1280.png") });
    await s.close();

    check(pageErrors.length === 0, `no page errors (${pageErrors.join(" | ") || "none"})`);
    check(external.length === 0, `no external requests (${external.slice(0, 3).join(", ") || "none"})`);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log("\nAll e2e checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
