// The promo page ships as static files from hosted/static/promo, so a typo in an asset path only shows up after deploy.
// It also quotes the rules' output and the measured numbers, so those are checked against the engine here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payRisk, atoms } from "../extension/lib/index.js";

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

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const strip = (s) => decode(s.replace(/<[^>]+>/g, ""));

// Plain text of a marked-up message, and where each <mark> sits in it.
function readMarks(inner) {
  const marks = [];
  const re = /<mark class="(\w+)">([\s\S]*?)<\/mark>/g;
  let text = "";
  let last = 0;
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    text += strip(inner.slice(last, m.index));
    const body = strip(m[2]);
    marks.push({ kind: m[1], start: text.length, end: text.length + body.length });
    text += body;
    last = re.lastIndex;
  }
  return { text: text + strip(inner.slice(last)), marks };
}

// Same merge as the playground in promo.js: overlapping hits become one mark.
function engineMarks(text, verdictKind) {
  const rank = verdictKind === "risk" ? { weak: 1, safe: 2, strong: 3 } : { weak: 1, strong: 2, safe: 3 };
  const hits = atoms.findAtoms(text)
    .map((hit) => ({ start: hit.start, end: hit.end, kind: hit.role === "veto" ? "safe" : hit.strength === "strong" ? "strong" : "weak" }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const hit of hits) {
    const prev = merged[merged.length - 1];
    if (prev && hit.start < prev.end) {
      prev.end = Math.max(prev.end, hit.end);
      if (rank[hit.kind] > rank[prev.kind]) prev.kind = hit.kind;
    } else merged.push(hit);
  }
  return merged;
}

const receipts = (verdict) => verdict.signals.map((id) => atoms.ATOMS.find((a) => a.id === id).receipt);

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

test("promo: reduced motion gets the static page, and nothing animates outside the read", () => {
  assert.match(html, /prefers-reduced-motion: reduce\)"\)\.matches\) return/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const m of css.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/, "").matchAll(/([^{}]+)\{[^{}]*\banimation:/g)) {
    assert.match(m[1], /\.read/, `animation outside .read: ${m[1].trim()}`);
  }
});

test("promo: the hero message and card are what the rules return", async () => {
  const hero = "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow with GLS. The other 1,350 kr when it arrives.";
  const bubble = html.match(/<blockquote class="bubble">([\s\S]*?)<\/blockquote>/)[1];
  assert.equal(strip(bubble).trim(), hero);
  const verdict = await payRisk.detect(hero, { from: "seller" }, {});
  assert.equal(verdict.level, "high");
  assert.deepEqual([...bubble.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/g)].map((m) => strip(m[1])), verdict.evidence.map((e) => e.text));
  assert.equal(strip(html.match(/<p class="pb-explain">([\s\S]*?)<\/p>/)[1]), verdict.reason);
  assert.deepEqual([...html.matchAll(/<li class="chip">([\s\S]*?)<\/li>/g)].map((m) => strip(m[1])), receipts(verdict));
});

test("promo: each listed message shows the verdict and marks the rules return", async () => {
  const rows = [...html.matchAll(/<li class="row" data-sweep>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 5);
  for (const row of rows) {
    const { text, marks } = readMarks(row.match(/<blockquote class="msg"><p>([\s\S]*?)<\/p><\/blockquote>/)[1]);
    const verdict = await payRisk.detect(text, { from: "seller" }, {});
    assert.deepEqual(marks, engineMarks(text, verdict.kind), text);
    const state = row.match(/<p class="state (card|none)">([^<]+)<\/p>/);
    if (state[1] === "card") {
      assert.equal(verdict.kind, "risk", text);
      assert.equal(verdict.level, "high", text);
      assert.equal(state[2], "High risk payment request");
      assert.equal(strip(row.match(/<p class="reason">([\s\S]*?)<\/p>/)[1]), verdict.reason);
      assert.equal(strip(row.match(/<p class="sig">([\s\S]*?)<\/p>/)[1]), receipts(verdict).join(" · "));
    } else {
      assert.equal(verdict.kind, "silent", text);
      assert.equal(state[2], "No card");
    }
  }
});

test("promo: every unit chart draws exactly the numbers in its label", () => {
  const charts = [...html.matchAll(/<svg class="units"[^>]*aria-label="(\d+) of (\d+)[^"]*">([\s\S]*?)<\/svg>/g)];
  assert.equal(charts.length, 6);
  for (const [, flagged, total, body] of charts) {
    let hits = 0;
    let all = 0;
    for (const [, w, h, state, small] of body.matchAll(/width="(\d+)" height="(\d+)" fill="url\(#u-(\w+?)(-s)?\)"/g)) {
      const pitch = small ? 9 : 21;
      const gap = small ? 2 : 3;
      const cells = ((Number(w) + gap) / pitch) * ((Number(h) + gap) / pitch);
      all += cells;
      if (state === "flag" || state === "false") hits += cells;
    }
    assert.equal(hits, Number(flagged));
    assert.equal(all, Number(total));
  }
});

test("promo: the copy avoids claims the product cannot make", () => {
  const copy = strip(html.slice(html.indexOf("<body")));
  assert.doesNotMatch(copy, /TF-IDF|AI-powered|seamless|guaranteed|protects you/i);
  assert.match(copy, /Buyer Protection may be eligible/);
});

test("promo: the build copies the rules files the playground loads", () => {
  const build = fs.readFileSync(path.join(root, "scripts", "build-hosted.mjs"), "utf8");
  for (const name of ["brand", "tidy", "atoms", "extract", "redact", "pay-risk"]) {
    assert.ok(fs.existsSync(path.join(root, "extension", "lib", `${name}.js`)), name);
    assert.ok(build.includes(`"${name}"`), `build does not copy ${name}`);
    assert.ok(fs.readFileSync(path.join(dir, "promo.js"), "utf8").includes(`"${name}"`), `promo.js does not load ${name}`);
  }
  // Empty in the source so an unbuilt copy keeps the form hidden; the build points it at the copied files.
  assert.ok(html.includes('data-rules-lib=""'));
  assert.ok(build.includes(`.replace('data-rules-lib=""', 'data-rules-lib="lib/"')`));
});
