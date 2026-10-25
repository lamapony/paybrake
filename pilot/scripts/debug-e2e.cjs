// Glue: run the fixture with the extension, enable debug, add the scam message, dump console + DOM state.
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require(process.env.PWC || "/home/box/.local/lib/node_modules/playwright-core");
const pilot = path.resolve(__dirname, ".."), ext = path.join(pilot, "extension");
const fixture = fs.readFileSync(path.join(pilot, "fixtures", "messenger-thread.html"), "utf8");
(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pb-dbg-"));
  const ctx = await chromium.launchPersistentContext(prof, { executablePath: "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await ctx.route(/^https:\/\/www\.facebook\.com\//, (r) => r.request().resourceType() === "document" ? r.fulfill({ contentType: "text/html", body: fixture }) : r.abort());
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
  sw.on("console", (m) => console.log("[sw]", m.type(), m.text()));
  await sw.evaluate(() => chrome.storage.local.set({ pb_opts: { debug: true, checkOwn: false } }));
  const p = await ctx.newPage();
  p.on("console", (m) => console.log("[page]", m.type(), m.text()));
  p.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  await p.goto("https://www.facebook.com/messages/t/1/");
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.fixture.addIncoming("Price is 1800 kr but send 500 kr deposit via PayPal Friends & Family today and I hold it for you. Only shipping, I'm in Aarhus"));
  await p.waitForTimeout(4000);
  console.log("cards:", await p.locator('[data-paybrake="card"]').count());
  console.log("html:", await p.evaluate(() => document.documentElement.dataset.paybrake + " | " + [...document.querySelectorAll('[role="row"]')].slice(-2).map((r) => r.outerHTML).join("\n")));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
