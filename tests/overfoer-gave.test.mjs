import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("overfør and MobilePay som gave with an amount are friends and family", async () => {
  const texts = [
    "Overfør 500 kr som gave, jeg sender i morgen.",
    "MobilePay 500 kr som gave, jeg sender i morgen."
  ];
  for (const text of texts) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["friends_family"], text);
    assert.equal(verdict.deal.amount, 500, text);
  }
});

test("existing gift asks and the non-asks stay put", async () => {
  const send = await detect("Send 500 kr som gave, jeg sender i morgen.");
  assert.equal(send.kind, "risk");
  assert.equal(send.level, "medium");
  assert.deepEqual(send.signals, ["friends_family"]);
  assert.equal(send.deal.amount, 500);

  const english = await detect("Send 500 kr as a gift via MobilePay, I ship tomorrow.");
  assert.equal(english.kind, "risk");
  assert.equal(english.level, "high");
  assert.ok(english.signals.includes("friends_family"));
  assert.ok(english.signals.includes("off_platform"));
  assert.ok(english.signals.includes("ship_before_meet"));
  assert.equal(english.deal.amount, 500);

  const museum = await detect("Overfør billederne som gave til museet i næste uge.");
  assert.equal(museum.kind, "silent");
  assert.equal(museum.silentReason, "no_atom");
  assert.deepEqual(museum.signals, []);

  const down = await detect("MobilePay is down today, call the shop instead.");
  assert.equal(down.kind, "silent");
  assert.equal(down.silentReason, "no_atom");
  assert.deepEqual(down.signals, []);
});
