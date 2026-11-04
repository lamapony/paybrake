import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("card.css: desktop shows the full card, the compact parts stay hidden", async () => {
  const css = await readFile(path.join(root, "extension", "card.css"), "utf8");
  assert.match(css, /\.pb-headline-short,\s*\.pb-level,\s*\.pb-toggle\s*\{\s*display:\s*none/);
  assert.match(css, /\.pb-details\s*\{\s*display:\s*block/);
  // The full headline is the default; only the narrow block swaps it out.
  assert.equal(/\.pb-headline-long\s*\{[^}]*display:\s*none/.test(css.split("@media (max-width: 520px)")[0]), false);
});

test("card.css: narrow viewports collapse the details and clamp the advice to one line", async () => {
  const css = await readFile(path.join(root, "extension", "card.css"), "utf8");
  const block = css.slice(css.indexOf("@media (max-width: 520px)"));
  assert.match(block, /\.pb-details\s*\{\s*display:\s*none/);
  assert.match(block, /-webkit-line-clamp:\s*1/);
  assert.match(block, /\.pb-open\s+\.pb-details\s*\{\s*display:\s*block/);
  assert.match(block, /\.pb-toggle\s*\{[^}]*display:\s*inline-flex/);
  assert.match(block, /\.pb-headline-long\s*\{\s*display:\s*none/);
  assert.match(block, /\.pb-level\s*\{/);
});

test("the in-file CSS fallback mirrors the compact rules", async () => {
  const js = await readFile(path.join(root, "extension", "content.js"), "utf8");
  const fb = js.slice(js.indexOf("function fallbackCss()"));
  assert.match(fb, /\.pb-details\{display:none\}/);
  assert.match(fb, /\.pb-toggle\{display:inline-flex/);
  assert.match(fb, /-webkit-line-clamp:1/);
  assert.match(fb, /\.pb-headline-long\{display:none\}/);
});
