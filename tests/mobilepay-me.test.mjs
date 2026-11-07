import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("MobilePay me with an amount is off-platform, and a request with no sum stays quiet", async () => {
  const shipText = "MobilePay me 500 kr today, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "MobilePay me"));

  const lamp = await detect("MobilePay me 500 kr for the lamp today.");
  assert.equal(lamp.kind, "risk");
  assert.equal(lamp.level, "medium");
  assert.deepEqual(lamp.signals, ["off_platform"]);
  assert.equal(lamp.deal.amount, 500);
  assert.equal(lamp.deal.currency, "DKK");

  const pickup = await detect("MobilePay me 500 kr for the lamp today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const tracking = await detect("MobilePay me the tracking number tomorrow afternoon.");
  assert.equal(tracking.kind, "silent");
  assert.equal(tracking.silentReason, "no_atom");
  assert.deepEqual(tracking.signals, []);

  const tickets = await detect("I paid with MobilePay yesterday for the museum tickets.");
  assert.equal(tickets.kind, "silent");
  assert.equal(tickets.silentReason, "no_atom");
  assert.deepEqual(tickets.signals, []);

  const fine = await detect("MobilePay is fine when you pick it up on Thursday.");
  assert.equal(fine.kind, "silent");
  assert.equal(fine.silentReason, "veto");
  assert.deepEqual(fine.signals, []);

  const via = await detect("Please send 500 kr via MobilePay today, I ship tomorrow.");
  assert.equal(via.kind, "risk");
  assert.equal(via.level, "high");
  assert.deepEqual(via.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(via.deal.amount, 500);
});
