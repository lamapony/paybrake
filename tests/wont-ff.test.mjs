import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("refusing to take PayPal F&F is silent", async () => {
  const alone = await detect("I won't take PayPal F&F.");
  assert.equal(alone.kind, "silent");
  assert.notEqual(alone.kind, "risk");
  assert.deepEqual(alone.signals, []);

  const checkout = await detect("I won't take PayPal F&F, use checkout.");
  assert.equal(checkout.kind, "silent");
  assert.notEqual(checkout.kind, "risk");
});

test("checkout veto and a real F&F ask stay where they were", async () => {
  const theCheckout = await detect("I won't take PayPal F&F, use the checkout.");
  assert.equal(theCheckout.kind, "silent");
  assert.equal(theCheckout.silentReason, "veto");

  const refused = await detect("Don't use the checkout, send 500 kr via PayPal F&F, I ship tomorrow.");
  assert.equal(refused.kind, "risk");
  assert.equal(refused.level, "high");
  assert.equal(refused.deal.amount, 500);
  assert.ok(refused.signals.includes("friends_family"));
  assert.ok(refused.signals.includes("ship_before_meet"));

  const sibling = await detect("Don't use checkout, send 500 kr via PayPal F&F, I ship tomorrow.");
  assert.equal(sibling.kind, "risk");
  assert.equal(sibling.level, "high");
  assert.equal(sibling.deal.amount, 500);
  assert.ok(sibling.signals.includes("friends_family"));

  const ask = await detect("Send 500 kr via PayPal F&F, I ship tomorrow.");
  assert.equal(ask.kind, "risk");
  assert.equal(ask.level, "high");
  assert.equal(ask.deal.amount, 500);

  const through = await detect("Pay through the checkout when you pick it up.");
  assert.equal(through.kind, "silent");
  assert.equal(through.silentReason, "veto");

  const use = await detect("Use checkout, I do not take Friends and Family.");
  assert.equal(use.kind, "silent");
  assert.equal(use.silentReason, "no_atom");
  assert.deepEqual(use.signals, []);
});

test("never send via F&F is still a hit for the prohibition layer", () => {
  const hits = findAtoms("Never send 500 kr. via F&F for this bike.");
  assert.ok(hits.some((hit) => hit.atom === "friends_family"));
});
