import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("N26 with an amount is off-platform, and a mention without a sum is not", async () => {
  const shipText = "Please send 500 kr via N26 today, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(ship.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "I ship tomorrow"));
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "N26"));

  const bike = await detect("Please send 500 kr via N26 today, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Please send 500 kr via N26 today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const file = await detect("Please send the file via N26 tomorrow.");
  assert.equal(file.kind, "silent");
  assert.equal(file.silentReason, "no_atom");
  assert.deepEqual(file.signals, []);
  assert.equal(file.deal.amount, null);

  const lamp = await detect("The N26 lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
});

test("26 and n2 are not N26, and Klarna with ship stays high", async () => {
  const twentySixText = "Please send 500 kr via 26 today, I ship tomorrow.";
  const twentySix = await detect(twentySixText);
  assert.equal(twentySix.kind, "silent");
  assert.equal(twentySix.silentReason, "weak_only");
  assert.deepEqual(twentySix.signals, ["ship_before_meet"]);
  assert.equal(findAtoms(twentySixText).some((hit) => hit.atom === "off_platform"), false);

  const n2Text = "Please send 500 kr via n2 today, I ship tomorrow.";
  const n2 = await detect(n2Text);
  assert.equal(n2.kind, "silent");
  assert.equal(n2.silentReason, "weak_only");
  assert.deepEqual(n2.signals, ["ship_before_meet"]);
  assert.equal(findAtoms(n2Text).some((hit) => hit.atom === "off_platform"), false);

  const klarna = await detect("Please send 500 kr via Klarna today, I ship tomorrow.");
  assert.equal(klarna.kind, "risk");
  assert.equal(klarna.level, "high");
  assert.deepEqual(klarna.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(klarna.deal.amount, 500);
});
