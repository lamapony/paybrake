import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Twint with an amount is off-platform, and a mention without a sum is not", async () => {
  const shipText = "Please send 500 kr via Twint today, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "Twint"));

  const bike = await detect("Please send 500 kr via Twint today, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Please send 500 kr via Twint today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const file = await detect("Please send the file via Twint tomorrow.");
  assert.equal(file.kind, "silent");
  assert.equal(file.silentReason, "no_atom");
  assert.deepEqual(file.signals, []);
  assert.equal(file.deal.amount, null);

  const town = await detect("Twint is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);

  const lamp = await detect("The Twint lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.ok(lamp.silentReason === "veto" || lamp.silentReason === "no_atom");
  assert.deepEqual(lamp.signals, []);
});

test("twin and twist are not Twint, and Klarna with ship stays high", async () => {
  const twin = await detect("Please send 500 kr via twin today, I ship tomorrow.");
  assert.equal(twin.kind, "silent");
  assert.equal(twin.silentReason, "weak_only");
  assert.deepEqual(twin.signals, ["ship_before_meet"]);
  assert.equal(findAtoms("Please send 500 kr via twin today, I ship tomorrow.").some((hit) => hit.atom === "off_platform"), false);

  const twist = await detect("Please send 500 kr via twist today, I ship tomorrow.");
  assert.equal(twist.kind, "silent");
  assert.equal(twist.silentReason, "weak_only");
  assert.deepEqual(twist.signals, ["ship_before_meet"]);
  assert.equal(findAtoms("Please send 500 kr via twist today, I ship tomorrow.").some((hit) => hit.atom === "off_platform"), false);

  const klarna = await detect("Please send 500 kr via Klarna today, I ship tomorrow.");
  assert.equal(klarna.kind, "risk");
  assert.equal(klarna.level, "high");
  assert.deepEqual(klarna.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(klarna.deal.amount, 500);
});
