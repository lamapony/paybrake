import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("a past payment with no amount stays silent", async () => {
  const quiet = [
    "I paid upfront for the service.",
    "We paid for the repair upfront.",
    "I paid for the service upfront.",
    "I already paid the deposit for my flat."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

test("an amount or a real ask is not rewritten as history", async () => {
  const pay = await detect("Pay 500 kr upfront, I ship tomorrow.");
  assert.equal(pay.kind, "risk");
  assert.equal(pay.level, "high");
  assert.deepEqual(pay.signals, ["upfront_deposit", "ship_before_meet"]);
  assert.equal(pay.deal.amount, 500);

  const deposit = await detect("Send the deposit of 500 kr, I ship tomorrow.");
  assert.equal(deposit.kind, "risk");
  assert.equal(deposit.level, "high");
  assert.deepEqual(deposit.signals, ["upfront_deposit", "ship_before_meet"]);
  assert.equal(deposit.deal.amount, 500);

  const paid = await detect("I paid 500 kr upfront for the bike.");
  assert.equal(paid.kind, "risk");
  assert.equal(paid.level, "medium");
  assert.deepEqual(paid.signals, ["upfront_deposit"]);
  assert.equal(paid.deal.amount, 500);

  const two = await detect("Send me 2 in advance.");
  assert.equal(two.kind, "risk");
  assert.equal(two.level, "medium");
  assert.deepEqual(two.signals, ["upfront_deposit"]);

  const none = await detect("No deposit needed before we meet.");
  assert.equal(none.kind, "silent");
  assert.equal(none.silentReason, "no_atom");
  assert.deepEqual(none.signals, []);
});
