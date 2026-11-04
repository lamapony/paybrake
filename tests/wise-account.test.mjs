import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("to my Wise account with money is off-platform, a file or a town is not", async () => {
  const ship = await detect("Please send 500 kr to my Wise account today, I ship tomorrow.");
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");

  const bike = await detect("Please send 500 kr to my Wise account today, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Please send 500 kr to my Wise account today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);

  const file = await detect("Please send the file to my Wise account tomorrow.");
  assert.equal(file.kind, "silent");
  assert.equal(file.silentReason, "no_atom");
  assert.deepEqual(file.signals, []);
  assert.equal(file.deal.amount, null);

  const town = await detect("Wise is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);

  const uncle = await detect("My wise uncle wrote a long letter yesterday afternoon.");
  assert.equal(uncle.kind, "silent");
  assert.equal(uncle.silentReason, "no_atom");
  assert.deepEqual(uncle.signals, []);

  const using = await detect("Please send 500 kr using Wise today, I ship tomorrow.");
  assert.equal(using.kind, "risk");
  assert.equal(using.level, "high");
  assert.ok(using.signals.includes("off_platform"));
  assert.ok(using.signals.includes("ship_before_meet"));
  assert.ok(using.evidence.some((span) => /using wise/i.test(span.text)));
});
