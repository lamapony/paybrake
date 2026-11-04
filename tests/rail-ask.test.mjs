import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("a direct rail ask is medium, and payment-as-a-noun is silent", async () => {
  const asks = [
    "Venmo me now, we can meet tomorrow afternoon.",
    "Zelle me now, then I will see you on Thursday afternoon.",
    "Cash App me now, we can meet tomorrow afternoon.",
    "MoneyGram me now, we can meet tomorrow afternoon."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.deal.amount, null, text);
  }

  const money = await detect("Zelle me the money and I ship tomorrow.");
  assert.equal(money.kind, "risk");
  assert.equal(money.level, "high");
  assert.deepEqual(money.signals, ["off_platform", "ship_before_meet"]);

  const venmo = await detect("Please send 500 kr via Venmo today, I ship tomorrow.");
  assert.equal(venmo.kind, "risk");
  assert.equal(venmo.level, "high");
  assert.deepEqual(venmo.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(venmo.deal.amount, 500);

  const quiet = [
    "Venmo is a payment app I read about yesterday with my sister.",
    "Venmo payment protection does not cover this lamp from the store.",
    "Western Union is a street I walked down yesterday afternoon.",
    "We can chat about Venmo when we meet tomorrow afternoon.",
    "Swish me now, we can meet tomorrow afternoon.",
    "Vipps me now, we can meet tomorrow afternoon."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
    assert.deepEqual(verdict.evidence, [], text);
  }
});
