import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Trustly with an amount is off-platform, and a mention without a sum is not", async () => {
  const shipText = "Please send 500 kr via Trustly today, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(ship.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "I ship tomorrow"));
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "Trustly"));

  const bike = await detect("Please send 500 kr via Trustly today, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Please send 500 kr via Trustly today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const shipDaText = "Send 500 kr via Trustly i dag, jeg kan kun sende varen.";
  const shipDa = await detect(shipDaText);
  assert.equal(shipDa.kind, "risk");
  assert.equal(shipDa.level, "high");
  assert.deepEqual(shipDa.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(shipDa.deal.amount, 500);
  assert.equal(shipDa.deal.currency, "DKK");
  assert.ok(shipDa.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "kan kun sende"));
  assert.ok(findAtoms(shipDaText).some((hit) => hit.atom === "off_platform" && hit.text === "Trustly"));

  const file = await detect("Please send the file via Trustly tomorrow.");
  assert.equal(file.kind, "silent");
  assert.equal(file.silentReason, "no_atom");
  assert.deepEqual(file.signals, []);
  assert.equal(file.deal.amount, null);

  const town = await detect("Trustly is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);

  const lamp = await detect("The Trustly lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
});

test("trust is not Trustly, and Klarna with ship stays high", async () => {
  const trustText = "Please send 500 kr via trust today, I ship tomorrow.";
  const trust = await detect(trustText);
  assert.equal(trust.kind, "silent");
  assert.equal(trust.silentReason, "weak_only");
  assert.deepEqual(trust.signals, ["ship_before_meet"]);
  assert.equal(findAtoms(trustText).some((hit) => hit.atom === "off_platform"), false);

  const klarna = await detect("Please send 500 kr via Klarna today, I ship tomorrow.");
  assert.equal(klarna.kind, "risk");
  assert.equal(klarna.level, "high");
  assert.deepEqual(klarna.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(klarna.deal.amount, 500);
});
