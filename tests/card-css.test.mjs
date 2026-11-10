import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

async function cardCss() {
  return readFile(path.join(root, "extension", "card.css"), "utf8");
}

async function contentJs() {
  return readFile(path.join(root, "extension", "content.js"), "utf8");
}

async function fallbackSource() {
  const js = await contentJs();
  const start = js.indexOf("function fallbackCss()");
  assert.ok(start > 0, "fallbackCss not found");
  return js.slice(start, js.indexOf("\n  }\n", start));
}

// The light-DOM copy of the card that visitors without the extension see.
async function marketplaceCardCss() {
  const html = await readFile(path.join(root, "demo", "marketplace.html"), "utf8");
  const start = html.indexOf("/* ---------- PayBrake risk card ---------- */");
  const end = html.indexOf("/* ---------- /PayBrake risk card ---------- */");
  assert.ok(start > 0 && end > start, "marketplace card CSS section not found");
  return html.slice(start, end);
}

test("card.css: desktop shows the full card, the compact parts stay hidden", async () => {
  const css = await cardCss();
  assert.match(css, /\.pb-toggle\s*\{\s*display:\s*none/);
  assert.match(css, /\.pb-details\s*\{\s*display:\s*block/);
});

test("card.css: narrow viewports collapse the details and clamp the advice to one line", async () => {
  const css = await cardCss();
  const block = css.slice(css.indexOf("@media (max-width: 520px)"));
  assert.match(block, /\.pb-details\s*\{\s*display:\s*none/);
  assert.match(block, /-webkit-line-clamp:\s*1/);
  assert.match(block, /\.pb-open\s+\.pb-details\s*\{\s*display:\s*block/);
  assert.match(block, /\.pb-toggle\s*\{[^}]*display:\s*inline-flex/);
  // The toggle is a real tap target now, not a 32px capsule.
  assert.match(block, /\.pb-toggle\s*\{[^}]*min-height:\s*44px/);
  // The primary action fills the row; the quiet one stays a left-aligned text link.
  assert.match(block, /\.actions \.btn-primary\s*\{\s*width:\s*100%/);
  assert.equal(/\.actions \.btn\s*\{\s*width:\s*100%/.test(block), false);
});

test("card.css: the footnote slip (ink hairline, footnote rule, serif quotes, quiet action)", async () => {
  const css = await cardCss();
  assert.match(css, /\.pb\s*\{[^}]*border:\s*1px solid #14161a[^}]*border-radius:\s*2px/);
  assert.equal(/box-shadow/.test(css), false, "the card has no shadow");
  assert.equal(/\.pb::before/.test(css), false, "no coloured stripe");
  assert.match(css, /\.pb-notes::before\s*\{[^}]*width:\s*72px[^}]*height:\s*1px/);
  assert.match(css, /\.pb-quote\s*\{[^}]*Georgia[^}]*font-style:\s*italic/);
  // One note per line, and the quote is the evidence: ink, not grey.
  assert.match(css, /\.pb-notes\s*\{[^}]*display:\s*grid/);
  assert.equal(/\.pb-notes\s*\{[^}]*flex-wrap/.test(css), false);
  assert.match(css, /\.pb-quote\s*\{[^}]*color:\s*#14161a/);
  // 14px between the actions and the caption.
  assert.match(css, /\.pb-body\s*\{\s*padding:\s*16px 20px 12px/);
  assert.match(css, /\.pb-foot\s*\{[^}]*padding:\s*2px 20px 12px/);
  assert.match(css, /\.btn-ghost\s*\{[^}]*text-decoration:\s*underline/);
  assert.match(css, /\.btn\s*\{[^}]*border-radius:\s*2px/);
});

test("the in-file CSS fallback mirrors the compact rules", async () => {
  const fb = await fallbackSource();
  assert.match(fb, /\.pb-details\{display:none\}/);
  assert.match(fb, /\.pb-toggle\{display:inline-flex/);
  assert.match(fb, /-webkit-line-clamp:1/);
  assert.match(fb, /\.pb-notes::before\{/);
  assert.match(fb, /\.pb-quote\{font-family:Georgia/);
  assert.match(fb, /prefers-reduced-motion/);
});

test("no pills, chips, dots or pastel alert colours in any copy of the card", async () => {
  const sources = {
    "card.css": await cardCss(),
    fallbackCss: await fallbackSource(),
    "marketplace card CSS": await marketplaceCardCss()
  };
  const gone = ["risk-badge", ".chip", "pb-dot", "signals-label", "pb-level", "999px"];
  const pastel = ["#fef3f2", "#fecdca", "#fff8eb", "#f3c46b", "#6b4200", "#d9480f", "#f5a524", "#b42318", "#f1c27d", "#eef4ff", "#c7d7fe"];
  for (const [name, css] of Object.entries(sources)) {
    for (const bad of [...gone, ...pastel]) {
      assert.equal(css.toLowerCase().includes(bad), false, `${name} still contains ${bad}`);
    }
  }
  const js = await contentJs();
  assert.equal(/badgeSvg/.test(js), false, "content.js still draws the warning-triangle badge");
  for (const bad of ['"risk-badge"', '"chips"', '"chip"', '"pb-dot"', '"signals-label"', '"pb-level"']) {
    assert.equal(js.includes(bad), false, `content.js still renders ${bad}`);
  }
});

test("the marketplace copy mirrors the card: notes per line, ink quotes, ink flagged bubble", async () => {
  const css = await marketplaceCardCss();
  assert.match(css, /\.pb-notes\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.pb-quote\s*\{[^}]*color:\s*#14161a/);
  const html = await readFile(path.join(root, "demo", "marketplace.html"), "utf8");
  const flagged = html.slice(html.indexOf(".bubble.flagged {"), html.indexOf("}", html.indexOf(".bubble.flagged {")));
  assert.match(flagged, /border:\s*1\.5px solid #14161a/);
  assert.match(flagged, /box-shadow:\s*none/);
  assert.equal(/amber|rgba\(245/.test(flagged), false, "no amber ring or glow on the flagged bubble");
  // "Checked just now" lives in the caption, as on the live card.
  assert.equal(html.includes(">Checked just now<"), false);
  assert.ok(html.includes(">checked just now</span> · <span class=\"pb-seg\">only you can see this<"));
});

test("the in-page highlight is the amber band, not a rounded pastel pill", async () => {
  const js = await contentJs();
  const start = js.indexOf("function ensureMarkStyle()");
  const body = js.slice(start, js.indexOf("\n  }\n", start));
  assert.match(body, /mark\.pb-ev\{background:linear-gradient\(#ffc629,#ffc629\) no-repeat 0 62%\/100% 80%/);
  assert.match(body, /border-radius:0/);
  assert.equal(body.includes("#ffe7b3"), false);
});
