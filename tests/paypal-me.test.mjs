import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("PayPal me with an amount is off-platform, and a request with no sum stays quiet", async () => {
  const ship = await detect("Can you PayPal me 500 kr for the lamp, I ship tomorrow.");
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");

  const today = await detect("PayPal me 500 kr for the lamp today.");
  assert.equal(today.kind, "risk");
  assert.equal(today.level, "medium");
  assert.deepEqual(today.signals, ["off_platform"]);
  assert.equal(today.deal.amount, 500);
  assert.equal(today.deal.currency, "DKK");

  const pickup = await detect("PayPal me 500 kr for the lamp today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.deal.amount, 500);

  const tracking = await detect("PayPal me the tracking number tomorrow afternoon.");
  assert.equal(tracking.kind, "silent");
  assert.equal(tracking.silentReason, "no_atom");
  assert.deepEqual(tracking.signals, []);

  const photo = await detect("Can you PayPal me the photo of the lamp tomorrow.");
  assert.equal(photo.kind, "silent");
  assert.equal(photo.silentReason, "no_atom");
  assert.deepEqual(photo.signals, []);

  const tickets = await detect("I paid with PayPal yesterday for the museum tickets.");
  assert.equal(tickets.kind, "silent");
  assert.equal(tickets.silentReason, "no_atom");
  assert.deepEqual(tickets.signals, []);

  const fine = await detect("PayPal is fine when you pick it up on Thursday.");
  assert.equal(fine.kind, "silent");
  assert.equal(fine.silentReason, "veto");
  assert.deepEqual(fine.signals, []);

  const link = await detect("Please send 500 kr via paypal.me/seller now, I ship tomorrow.");
  assert.equal(link.kind, "risk");
  assert.equal(link.level, "high");
  assert.deepEqual(link.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(link.deal.amount, 500);

  const mine = await detect("Please send 500 kr to my PayPal today, I ship tomorrow.");
  assert.equal(mine.kind, "silent");
  assert.equal(mine.silentReason, "weak_only");
  assert.deepEqual(mine.signals, ["ship_before_meet"]);
  assert.equal(mine.deal.amount, 500);
});
