import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Lunar with an amount is off-platform, and a mention without a sum is not", async () => {
  const shipText = "Please send 500 kr via Lunar today, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(ship.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "I ship tomorrow"));
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "Lunar"));

  const bike = await detect("Please send 500 kr via Lunar today, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Please send 500 kr via Lunar today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const bikeDa = await detect("Send 500 kr via Lunar i dag, cyklen er klar.");
  assert.equal(bikeDa.kind, "risk");
  assert.equal(bikeDa.level, "medium");
  assert.deepEqual(bikeDa.signals, ["off_platform"]);
  assert.equal(bikeDa.deal.amount, 500);
  assert.equal(bikeDa.deal.currency, "DKK");

  const shipDaText = "Send 500 kr via Lunar, jeg kan kun sende.";
  const shipDa = await detect(shipDaText);
  assert.equal(shipDa.kind, "risk");
  assert.equal(shipDa.level, "high");
  assert.deepEqual(shipDa.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(shipDa.deal.amount, 500);
  assert.equal(shipDa.deal.currency, "DKK");
  assert.ok(shipDa.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "kan kun sende"));
  assert.ok(findAtoms(shipDaText).some((hit) => hit.atom === "off_platform" && hit.text === "Lunar"));

  const file = await detect("Please send the file via Lunar tomorrow.");
  assert.equal(file.kind, "silent");
  assert.equal(file.silentReason, "no_atom");
  assert.deepEqual(file.signals, []);
  assert.equal(file.deal.amount, null);

  const town = await detect("Lunar is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);

  const lamp = await detect("The Lunar lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
});

test("luna is not Lunar, and Klarna with ship stays high", async () => {
  const lunaText = "Please send 500 kr via luna today, I ship tomorrow.";
  const luna = await detect(lunaText);
  assert.equal(luna.kind, "silent");
  assert.equal(luna.silentReason, "weak_only");
  assert.deepEqual(luna.signals, ["ship_before_meet"]);
  assert.equal(findAtoms(lunaText).some((hit) => hit.atom === "off_platform"), false);

  const klarna = await detect("Please send 500 kr via Klarna today, I ship tomorrow.");
  assert.equal(klarna.kind, "risk");
  assert.equal(klarna.level, "high");
  assert.deepEqual(klarna.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(klarna.deal.amount, 500);
});
