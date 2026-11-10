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
  assert.ok(body.includes('"pb-tags"'), "missing the state line");
  // The state line is only drawn when there is a state to show.
  assert.match(body, /const tagLine = tags\.length \? el\("p", "pb-tags"\) : null;/);
  assert.match(body, /if \(tagLine\) body\.append\(tagLine\);/);
  // "Checked just now" moved into the foot caption.
  assert.equal(body.includes('"Checked just now"'), false, "Checked just now belongs in the foot caption now");
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
      dataset: {},
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
  // A non-breaking space keeps the quote with its label.
  assert.ok(items.includes("Ships before you meet\u00a0“I ship tomorrow”"), items.join(" | "));
  assert.ok(items.includes("Upfront deposit\u00a0“deposit”"), items.join(" | "));
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
  assert.deepEqual(notes.childNodes.map((li) => li.textContent), ["Upfront deposit\u00a0“a deposit”", "Off-platform payment"]);
});

test("each quoted note carries data-pb-atom equal to its signal id; notes without evidence carry none", async () => {
  const { signalNotes } = await noteBuilders();
  const verdict = await payRisk.detect(bikeChat.map((m) => m.text).join("\n"), { messages: bikeChat });
  const notes = signalNotes({ ...verdict, signals: [...verdict.signals, "model_flag"] });
  const signals = [...verdict.signals, "model_flag"];
  notes.childNodes.forEach((li, index) => {
    const quoted = li.childNodes.some((child) => child.className === "pb-quote");
    if (quoted) assert.equal(li.dataset.pbAtom, signals[index], li.textContent);
  });
  const quotedCount = notes.childNodes.filter((li) => li.childNodes.some((child) => child.className === "pb-quote")).length;
  assert.ok(quotedCount >= 3, "the bike chat quotes at least three phrases");
  const flag = notes.childNodes.find((li) => li.textContent === "Reads like a scam chat");
  assert.equal(flag.dataset.pbAtom, undefined);
});

test("the foot caption says checked just now, except on a mock card", async () => {
  const js = await readFile(path.join(root, "extension", "content.js"), "utf8");
  const start = js.indexOf("  function footerText(");
  const source = js.slice(start, js.indexOf("\n  }\n", start) + 4);
  const footerText = new Function("aiNote", `${source}\nreturn footerText;`)(() => "rules check");
  assert.equal(footerText({}, { mode: "sandbox" }), "PayBrake · rules check · checked just now · only you can see this");
  assert.equal(footerText({}, { mode: null }), "PayBrake · rules check · checked just now · only you can see this");
  assert.equal(footerText({}, { mode: "mock" }), "PayBrake · rules check · only you can see this");
});

test("hovering a note links it to its marks in the page, scoped to the card's thread and cleaned up", async () => {
  const js = await readFile(path.join(root, "extension", "content.js"), "utf8");
  const slice = (name) => {
    const start = js.indexOf(`  function ${name}(`);
    assert.ok(start > 0, `${name} not found`);
    return js.slice(start, js.indexOf("\n  }\n", start) + 4);
  };
  assert.match(slice("wrapQuote"), /mark\.dataset\.pbAtom = atoms\.join\(" "\)/);
  const link = slice("linkNotes");
  for (const event of ["mouseenter", "focusin", "mouseleave", "focusout"]) assert.ok(link.includes(`"${event}"`), event);
  assert.match(slice("focusAtom"), /thread\.dataset\.pbFocus = atom/);
  assert.match(slice("clearFocus"), /delete thread\.dataset\.pbFocus/);
  assert.match(slice("unhighlight"), /clearFocus\(thread\)/);
  assert.match(slice("render"), /clearFocus\(session\.thread\)/);
  const style = slice("ensureMarkStyle");
  assert.match(style, /@media \(hover:hover\) and \(pointer:fine\)\{\[data-pb-focus\] mark\.pb-ev\{background-size:100% \.09em;background-position:0 93%/);
  assert.match(style, /\[data-pb-focus\] mark\.pb-ev\.pb-on\{background-size:100% 80%;background-position:0 62%\}/);
  assert.match(style, /prefers-reduced-motion:reduce\)\{\[data-pb-focus\] mark\.pb-ev\{transition:none\}/);
});

