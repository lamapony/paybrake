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
// The card's footnotes follow the marked phrases in reading order: note n is the signal behind mark n.
const footnotes = (verdict) => verdict.evidence.map((e) => atoms.ATOMS.find((a) => a.id === e.atom).receipt);
const notesIn = (s) => [...s.match(/<ol class="pb-notes"[^>]*>([\s\S]*?)<\/ol>/)[1].matchAll(/<li><span class="n"[^>]*>(\d)<\/span>([\s\S]*?)<\/li>/g)].map((m) => [m[1], strip(m[2])]);

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
  // The first sentence stands on its own line at every width.
  assert.match(html, /<h1 id="h1">The scam is one sentence long\.<br> PayBrake reads it before/);
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
  assert.deepEqual(notesIn(html), footnotes(verdict).map((r, i) => [String(i + 1), r]));
  assert.deepEqual([...footnotes(verdict)].sort(), [...receipts(verdict)].sort());
  assert.deepEqual(footnotes(verdict), ["Upfront deposit", "Friends & Family", "Ships before you meet"]);
  assert.match(html, /<p class="pb-title" id="pb-title">High risk payment request<\/p>/);
  assert.match(html, /<p class="pb-explain">Friends &amp; Family \+ upfront deposit: if the item never arrives, you may have no way to get your money back\.<\/p>/);
  // The bubble's marks carry the numerals 1, 2, 3 in the same order.
  for (const [i, cls] of ["m1", "m2", "m3"].entries()) assert.match(css, new RegExp(`\\.bubble mark\\.${cls}::after \\{ content: "${i + 1}"`));
});

test("promo: the warning card has no badge, chips, capsules or footer chrome", () => {
  for (const gone of ["risk-badge", 'class="chip"', "chips", "pb-foot", "pbtn ghost", "pb-dot", "signals-label", "Checked just now", "The card as the extension draws it"]) {
    assert.ok(!html.includes(gone), `still in the HTML: ${gone}`);
  }
  for (const gone of [".risk-badge", ".chip", ".pb-foot", ".pbtn.ghost", "#f1c27d", "#fef3f2", "#fecdca", "#fff8eb", "#f3c46b", "#6b4200", "#d9480f", "#f5a524", "border-radius: 999px"]) {
    assert.ok(!css.includes(gone), `still in the CSS: ${gone}`);
  }
  assert.match(html, /<p class="note"><span class="pb-meta">PayBrake · rules check · only you can see this<\/span>/);
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

test("promo: the marks legend is read before the rows, in the chapter head", () => {
  const head = html.match(/<section id="sentences"[\s\S]*?<div class="head">([\s\S]*?)<\/div>/)[1];
  assert.match(head, /<p class="intro">[\s\S]*?<\/p>\s*<p class="small key-marks">/);
  assert.equal(html.match(/class="small key-marks"/g).length, 1);
});

test("promo: every unit chart draws exactly the numbers in its label", () => {
  const charts = [...html.matchAll(/<svg class="units[^"]*"[^>]*aria-label="(\d+) of (\d+)[^"]*">([\s\S]*?)<\/svg>/g)];
  assert.equal(charts.length, 8);   // the public set is drawn twice: 96 columns wide, 40 on a phone
  for (const [, flagged, total, body] of charts) {
    let hits = 0;
    let all = 0;
    for (const [, w, h, state, field] of body.matchAll(/width="(\d+)" height="(\d+)" fill="url\(#u-(\w+?)(-f)?\)"/g)) {
      const pitch = field ? 14 : 21;
      const gap = 3;
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

test("promo: the chat thread uses the demo store's own lines and the rules' verdict", async () => {
  const demo = decode(fs.readFileSync(path.join(root, "demo", "marketplace.html"), "utf8"));
  const thread = html.match(/<a class="thread"[\s\S]*?<\/a>/)[0];
  const hero = "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow with GLS. The other 1,350 kr when it arrives.";
  assert.equal(strip(thread.match(/<div class="t-b" data-thread-msg>([\s\S]*?)<\/div>/)[1]), hero);
  for (const line of [
    "Hi Jonas, is the Allez still for sale? Could I come and see it on Thursday after work? I live in Frederiksberg.",
    "About: Specialized Allez road bike, 56 cm · 1,850 kr",
    "Jonas Holm"
  ]) {
    assert.ok(strip(thread).includes(line), `not in the thread: ${line}`);
    assert.ok(demo.includes(line), `not in the demo store: ${line}`);
  }
  const verdict = await payRisk.detect(hero, { from: "seller" }, {});
  assert.deepEqual([...thread.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/g)].map((m) => strip(m[1])), verdict.evidence.map((e) => e.text));
  assert.equal(strip(thread.match(/<div class="pb-explain">([\s\S]*?)<\/div>/)[1]), verdict.reason);
  assert.deepEqual(notesIn(thread), footnotes(verdict).map((r, i) => [String(i + 1), r]));
});

test("promo: the playground presets are real lines with the outcomes they demonstrate", async () => {
  const expected = [["risk", "high"], ["risk", "medium"], ["silent", undefined]];
  const presets = [...html.matchAll(/data-msg="([^"]+)"/g)].map((m) => decode(m[1]));
  assert.equal(presets.length, expected.length);
  for (const [i, message] of presets.entries()) {
    const verdict = await payRisk.detect(message, { from: "seller" }, {});
    assert.equal(verdict.kind, expected[i][0], message);
    assert.equal(verdict.level, expected[i][1], message);
  }
});

test("promo: the card keeps working links without JS and quotes the extension's collapsed state", () => {
  assert.match(html, /<a class="pbtn primary" href="#order" data-brake>Switch to a PayPal order<\/a>/);
  assert.match(html, /<a class="pbtn quiet" href="#anyway" data-anyway>Pay anyway<\/a>/);
  const content = fs.readFileSync(path.join(root, "extension", "content.js"), "utf8");
  const said = strip(html.match(/<p id="pb-said-text">([\s\S]*?)<\/p>/)[1]);
  assert.ok(content.includes(`"${said}"`), said);
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

test("promo: the #how heading reads as one sentence pair and splits into device and server fields", () => {
  const m = html.match(/<h2 id="how-h">([\s\S]*?)<\/h2>/);
  assert.ok(m, "#how heading present");
  assert.equal(strip(m[1]), "Two checks run on your device. A third can run on a server.");
  assert.match(m[1], /<span class="h-dev">Two checks run on your device\.<\/span>/);
  assert.match(m[1], /<span class="h-srv">A third can run on a server\.<\/span>/);
  assert.match(css, /#how::before\s*\{/, "server field is drawn");
});
