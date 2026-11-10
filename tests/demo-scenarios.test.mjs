// The built-in preview (demo/marketplace.html without ?live=1) shows a static card per chat.
// The page says each card is what the rules return for that chat, word for word: check it.
// Also locks the ids the extension tests and the start page depend on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payRisk, atoms } from "../extension/lib/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "demo", "marketplace.html"), "utf8");
const home = fs.readFileSync(path.join(root, "hosted", "static", "index.html"), "utf8");

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (s) => decode(s.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? decode(m[1]) : "";
};

// Each chat section, from its opening tag to the next chat section (or the end of the chat column).
function threads() {
  const out = [];
  const re = /<section class="card chat" id="(thread-[a-z]+)"[^>]*>/g;
  const starts = [];
  for (let m = re.exec(html); m; m = re.exec(html)) starts.push({ id: m[1], tag: m[0], at: m.index });
  const end = html.indexOf('<aside class="side"');
  starts.forEach((s, i) => out.push({ ...s, body: html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : end) }));
  return out;
}

// Same message selection as content.js readMessages: every seller line, and only the last buyer line.
function messages(body) {
  const all = [...body.matchAll(/<div class="bubble[^"]*" data-pb-msg data-from="(buyer|seller)">([\s\S]*?)<\/div>/g)]
    .map((m) => ({ from: m[1], text: text(m[2]) }));
  const lastBuyer = all.map((m) => m.from).lastIndexOf("buyer");
  return all.filter((m, i) => m.from !== "buyer" || i === lastBuyer).filter((m) => m.text);
}

const label = (id) => (atoms.ATOMS.find((a) => a.id === id) || {}).receipt || id;

test("demo: the five chats exist, and the picker keeps the ids the extension tests click", () => {
  const ids = threads().map((t) => t.id);
  assert.deepEqual(ids, ["thread-bike", "thread-camera", "thread-chair", "thread-console", "thread-lamp"]);
  assert.match(html, /id="pb-show-thread-1"[^>]*data-thread="thread-bike"/);
  assert.match(html, /id="pb-show-thread-2"[^>]*data-thread="thread-camera"/);
  // The bike chat is the one open on arrival; the others start hidden.
  for (const t of threads()) assert.equal(/\shidden>$/.test(t.tag), t.id !== "thread-bike", t.id + " hidden state");
  // Exactly one element carries each id that scripts/shot-demo.cjs and the e2e tests select.
  for (const id of ["pb-card", "pb-protect", "pb-anyway", "pb-foot", "pb-title"]) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id + " must be unique");
  }
});

test("demo: every static card is the rules' own verdict for its chat; the lamp chat gets none", async () => {
  for (const t of threads()) {
    const msgs = messages(t.body);
    const context = {
      listingTitle: attr(t.tag, "data-pb-listing-title"),
      listingPrice: attr(t.tag, "data-pb-listing-price"),
      sellerName: attr(t.tag, "data-pb-seller-name"),
      sellerEmail: attr(t.tag, "data-pb-seller-email"),
      messages: msgs
    };
    const verdict = await payRisk.detect(msgs.map((m) => m.text).join("\n"), context, {});
    const card = t.body.match(/<aside class="pb"[\s\S]*?<\/aside>/);
    if (t.id === "thread-lamp") {
      assert.equal(card, null, "lamp chat must not carry a card");
      assert.equal(payRisk.isPaymentRisk(verdict), false, "rules flag the lamp chat");
      assert.equal(/<mark/.test(t.body), false, "lamp chat has no marks");
      continue;
    }
    assert.ok(card, t.id + " has no static card");
    const c = card[0];
    assert.match(c, /data-pb-static/);
    assert.equal(verdict.level, attr(c.match(/<aside[^>]*>/)[0], "data-pb-risk"), t.id + " level");
    const title = text(c.match(/<p class="pb-title"[^>]*>([\s\S]*?)<\/p>/)[1]);
    assert.equal(title, verdict.level === "medium" ? "Possible payment risk" : "High risk payment request", t.id + " title");
    assert.equal(text(c.match(/<p class="pb-explain">([\s\S]*?)<\/p>/)[1]), verdict.reason, t.id + " reason");

    const notes = [...c.matchAll(/<li data-pb-atom="([a-z_]+)">([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], inner: m[2] }));
    assert.deepEqual(notes.map((n) => n.id), verdict.signals, t.id + " signals in engine order");
    const quoted = new Map();
    for (const e of verdict.evidence || []) if (e && e.atom && !quoted.has(e.atom)) quoted.set(e.atom, e.text.replace(/\s+/g, " ").trim());
    for (const n of notes) {
      const q = n.inner.match(/<span class="pb-quote">“([\s\S]*?)”<\/span>/);
      assert.ok(text(n.inner).startsWith(label(n.id)), `${t.id} note label for ${n.id}`);
      const phrase = quoted.get(n.id);
      if (phrase && phrase.toLowerCase() !== label(n.id).toLowerCase()) {
        assert.ok(q, `${t.id} ${n.id} should quote “${phrase}”`);
        assert.equal(text(q[1]), phrase, `${t.id} ${n.id} quote`);
        // The highlighted words in the chat are the same phrase.
        assert.ok(t.body.includes(`<mark data-pb-atom="${n.id}">${phrase.replace(/&/g, "&amp;")}</mark>`), `${t.id} mark for ${n.id}`);
      } else {
        assert.equal(q, null, `${t.id} ${n.id} should not quote`);
      }
    }
    assert.ok(c.includes('>checked just now</span> · <span class="pb-seg">only you can see this<'), t.id + " caption");
  }
});

test("demo: honest money copy on the preview page", () => {
  const page = text(html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, ""));
  assert.ok(page.includes("may be eligible*"));
  assert.ok(page.includes("*Eligibility depends on PayPal terms and the transaction."));
  assert.ok(page.includes("No real money moves."));
  for (const bad of [/guarantee/i, /you are protected/i, /100% safe/i, /Facebook/, /\bMeta\b/]) assert.equal(bad.test(page), false, String(bad));
  // The sample order id in the static preview is labelled as such.
  assert.match(html, /Sandbox order created \(preview\) · sample ID <code>' \+ SAMPLE_ID/);
});

test("start page: the card is one click away, the extension is the second path", () => {
  const first = home.match(/<a class="btn[^"]*"[^>]*href="([^"]+)"/);
  assert.ok(first, "start page has a button");
  assert.equal(first[1], "/demo/marketplace.html", "the first button opens the built-in preview");
  assert.ok(home.includes('href="/demo/marketplace.html?live=1"'), "extension mode is still linked");
  assert.ok(home.includes('href="/paybrake-extension.zip"'), "the zip is still linked");
  assert.ok(home.includes('href="/demo/safe-chats.html'), "safe chats are still linked");
  const page = text(home.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, ""));
  assert.ok(page.includes("No real money moves"));
  assert.match(page, /sandbox when (?:the server has|configured)[^.]*otherwise (?:a )?mock/i);
  for (const bad of [/guarantee/i, /you are protected/i, /100% safe/i, /Facebook/, /\bMeta\b/]) assert.equal(bad.test(page), false, String(bad));
  // Fonts come from the promo's shipped files.
  for (const m of home.matchAll(/url\("([^"]+\.woff2)"\)/g)) {
    assert.ok(fs.existsSync(path.join(root, "hosted", "static", m[1])), m[1] + " missing");
  }
});
