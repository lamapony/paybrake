import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { payRisk, atoms } from "../extension/lib/index.js";

const root = path.resolve(import.meta.dirname, "..");

// The card is built inside the content-script IIFE, so it cannot be imported directly.
// These checks read the render source the way the other card test reads the CSS: they pin
// the action branches so a rewrite cannot silently drop the buttons (a bug found in QA).
async function fullCardSource() {
  const js = await readFile(path.join(root, "extension", "content.js"), "utf8");
  const start = js.indexOf("function fullCard(session)");
  assert.ok(start > 0, "fullCard not found");
  const end = js.indexOf("async function protectDeal", start);
  assert.ok(end > start, "protectDeal not found after fullCard");
  return js.slice(start, end);
}

test("a payment card offers the PayPal action and Pay anyway, wired to their handlers", async () => {
  const body = await fullCardSource();
  const payment = body.slice(body.indexOf("} else if (isPayment) {"));
  assert.ok(payment.includes('"pb-protect"'), "missing the Switch to a PayPal order button");
  assert.ok(payment.includes('"pb-anyway"'), "missing the Pay anyway button");
  assert.match(payment, /protectDeal\(session, emailInput, foot, protect\)/);
  assert.match(payment, /payAnyway\(session\)/);
});

test("a non-payment card offers only the dismiss action, never a PayPal order", async () => {
  const body = await fullCardSource();
  const dismissStart = body.indexOf("} else {\n      // No payment");
  assert.ok(dismissStart > 0, "missing the non-payment dismiss branch");
  const dismiss = body.slice(dismissStart);
  assert.ok(dismiss.includes('"pb-dismiss"'), "missing the Got it, hide this button");
  assert.ok(dismiss.includes("dismissCard(session)"), "dismiss button is not wired");
  assert.equal(/pb-protect|pb-anyway/.test(dismiss), false, "a non-payment card must not offer a PayPal order");
});

test("the title is a plain headline with the level in the words; Details toggle and details stay", async () => {
  const body = await fullCardSource();
  assert.ok(body.includes('"pb-title"'), "missing the plain headline");
  assert.match(body, /title\.id = "pb-title"/);
  for (const words of ["High risk payment request", "Possible payment risk", "Account safety risk"]) {
    assert.ok(body.includes(`"${words}"`), `missing the headline "${words}"`);
  }
  assert.ok(body.includes('"pb-tags"'), "missing the meta line");
  assert.ok(body.includes('"pb-toggle"'), "missing the Details toggle");
  assert.ok(body.includes('"pb-details"'), "missing the collapsible details");
  assert.match(body, /card\.classList\.toggle\("pb-open"\)/);
  for (const gone of ['"risk-badge"', '"pb-level"', '"pb-headline-short"', "badgeSvg", '"signals-label"', '"chips"']) {
    assert.equal(body.includes(gone), false, `fullCard still renders ${gone}`);
  }
});

// A tiny DOM, enough for the note builders: elements with classes, text and children.
function fakeDocument() {
  const text = (value) => ({ nodeType: 3, textContent: String(value) });
  const element = (tag) => {
    const node = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      className: "",
      attrs: {},
      childNodes: [],
      set textContent(value) { node.childNodes = [text(value)]; },
      get textContent() { return node.childNodes.map((child) => child.textContent).join(""); },
      get childElementCount() { return node.childNodes.filter((child) => child.nodeType === 1).length; },
      setAttribute(name, value) { node.attrs[name] = String(value); },
      append(...children) { node.childNodes.push(...children); }
    };
    return node;
  };
  return { createElement: element, createTextNode: text };
}

// Pull the note builders out of the content-script IIFE and run them on a real verdict.
async function noteBuilders() {
  const js = await readFile(path.join(root, "extension", "content.js"), "utf8");
  const pick = (name) => {
    const start = js.indexOf(`  function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    return js.slice(start, js.indexOf("\n  }\n", start) + 4);
  };
  const source = ["el", "chipLabel", "quotedPhrases", "signalNotes"].map(pick).join("\n");
  assert.equal(/innerHTML/.test(source), false, "the notes must be built from text nodes, not innerHTML");
  const make = new Function("document", "pbAtoms", `${source}\nreturn { signalNotes };`);
  return make(fakeDocument(), atoms);
}

const bikeChat = [
  { from: "buyer", text: "Hi Jonas, is the Allez still for sale? Could I come and see it on Thursday after work? I live in Frederiksberg." },
  { from: "seller", text: "Hi! Yes, still for sale. Several people are asking though, I've had three messages since this morning." },
  { from: "seller", text: "I'm working in Aarhus all week, so no viewings, sorry." },
  { from: "seller", text: "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow with GLS. The other 1,350 kr when it arrives." }
];

test("signal notes quote the seller's phrase the engine found, and show the label alone without one", async () => {
  const { signalNotes } = await noteBuilders();
  const verdict = await payRisk.detect(bikeChat.map((m) => m.text).join("\n"), { messages: bikeChat });
  assert.equal(verdict.kind, "risk");
  // An extra signal the engine never quoted (as the AI check or the model can add).
  const notes = signalNotes({ ...verdict, signals: [...verdict.signals, "model_flag"] });
  assert.equal(notes.tagName, "OL");
  assert.equal(notes.className, "pb-notes");
  assert.equal(notes.attrs["aria-label"], "Detected signals");
  const items = notes.childNodes.map((li) => li.textContent);
  assert.ok(items.includes("Ships before you meet “I ship tomorrow”"), items.join(" | "));
  assert.ok(items.includes("Upfront deposit “deposit”"), items.join(" | "));
  const ship = notes.childNodes.find((li) => li.textContent.startsWith("Ships before you meet"));
  const quote = ship.childNodes.find((child) => child.nodeType === 1);
  assert.equal(quote.className, "pb-quote");
  // No evidence for this signal: the label alone, no quote element.
  const flag = notes.childNodes.find((li) => li.textContent.startsWith("Reads like a scam chat"));
  assert.equal(flag.textContent, "Reads like a scam chat");
  assert.equal(flag.childElementCount, 0);
  // A quote that only repeats the label is dropped.
  assert.ok(items.includes("Friends & Family"), items.join(" | "));
  // No numbering in the product.
  assert.equal(items.some((item) => /^\d/.test(item)), false);
});

test("signal notes use the first quoted phrase per signal and never invent one", async () => {
  const { signalNotes } = await noteBuilders();
  const notes = signalNotes({
    signals: ["upfront_deposit", "off_platform"],
    evidence: [
      { atom: "upfront_deposit", text: "a deposit" },
      { atom: "upfront_deposit", text: "deposit now" },
      { text: "AI evidence without an atom" }
    ]
  });
  assert.deepEqual(notes.childNodes.map((li) => li.textContent), ["Upfront deposit “a deposit”", "Off-platform payment"]);
});

