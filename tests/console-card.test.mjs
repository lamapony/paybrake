import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("console and Netflix cards with money are off-platform, a topic is not", async () => {
  const shipped = [
    "Send a PlayStation card of 500 kr, I ship tomorrow.",
    "Send an Xbox card of 500 kr, I ship tomorrow.",
    "Send a Nintendo card of 500 kr, I ship tomorrow.",
    "Send a Netflix card of 500 kr, I ship tomorrow."
  ];
  for (const text of shipped) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"], text);
    assert.equal(verdict.deal.amount, 500, text);
  }

  const ready = [
    "Send a PlayStation card of 500 kr today, the bike is ready.",
    "Send a Netflix card of 500 kr today, the bike is ready."
  ];
  for (const text of ready) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.deal.amount, 500, text);
  }

  const pickup = await detect("Send a PlayStation card of 500 kr today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);

  const topics = [
    "The PlayStation in the living room is just the old console.",
    "The Xbox in the living room is just the old console.",
    "The Nintendo in the living room is just the old console.",
    "Netflix is a show we watched yesterday evening at home."
  ];
  for (const text of topics) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }

  const kept = [
    "Send an Apple gift card of 500 kr, I ship tomorrow.",
    "Send an Amazon card of 500 kr, I ship tomorrow.",
    "Send a Google Play card of 500 kr, I ship tomorrow.",
    "Send an iTunes card of 500 kr, I ship tomorrow."
  ];
  for (const text of kept) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.ok(verdict.signals.includes("off_platform"), text);
    assert.ok(verdict.signals.includes("ship_before_meet"), text);
  }

  const applePickup = await detect("Send an Apple gift card of 500 kr today, or you can pick it up.");
  assert.equal(applePickup.kind, "risk");
  assert.equal(applePickup.level, "medium");
  assert.equal(applePickup.signals.includes("ship_before_meet"), false);
  assert.ok(applePickup.signals.includes("off_platform"));
});
