import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

test("the compact parts (short headline, level pill, Details toggle) are in the card", async () => {
  const body = await fullCardSource();
  assert.ok(body.includes('"pb-headline-short"'), "missing the short headline");
  assert.ok(body.includes('"pb-headline-long"'), "missing the long headline");
  assert.ok(body.includes('"pb-level"'), "missing the level pill");
  assert.ok(body.includes('"pb-toggle"'), "missing the Details toggle");
  assert.ok(body.includes('"pb-details"'), "missing the collapsible details");
  assert.match(body, /card\.classList\.toggle\("pb-open"\)/);
});
