// The promo page ships as static files from hosted/static/promo, so a typo in an asset path only shows up after deploy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "hosted", "static", "promo");
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const css = fs.readFileSync(path.join(dir, "promo.css"), "utf8");

function exists(base, ref) {
  const clean = ref.split(/[?#]/)[0];
  // Root-relative paths are served from hosted/static.
  const file = clean.startsWith("/") ? path.join(root, "hosted", "static", clean) : path.join(base, clean);
  return fs.existsSync(file);
}

test("promo: every local asset in the HTML and CSS exists", () => {
  const refs = [
    ...[...html.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\bsrcset="([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/)[0]),
    ...[...css.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1])
  ].filter((ref) => !/^https?:|^mailto:/.test(ref));
  assert.ok(refs.length > 8);
  for (const ref of refs) assert.ok(exists(dir, ref), `missing ${ref}`);
});

test("promo: fonts and scripts are self-hosted", () => {
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /<link[^>]+href="https?:[^"]*(?:fonts\.|\.css)/);
  assert.doesNotMatch(css, /url\("?https?:/);
});

test("promo: one h1 and the real links", () => {
  assert.equal(html.match(/<h1[\s>]/g).length, 1);
  for (const url of [
    "https://paybrake-demo.spbabinov.workers.dev/",
    "https://paybrake-demo.spbabinov.workers.dev/demo/marketplace.html?live=1",
    "https://paybrake-demo.spbabinov.workers.dev/paybrake-extension.zip",
    "https://github.com/lamapony/paybrake"
  ]) assert.ok(html.includes(`"${url}"`), url);
});

test("promo: reduced motion gets the static page, no pin", () => {
  assert.match(html, /prefers-reduced-motion: reduce\)"\)\.matches\) return/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
