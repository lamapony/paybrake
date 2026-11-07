import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Klarna with an amount is off-platform, and a mention without a sum is not", async () => {
  const shipText = "Please send 500 kr via Klarna today, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "Klarna"));

  const bike = await detect("Please send 500 kr via Klarna today, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Please send 500 kr via Klarna today, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const book = await detect("Klarna is mentioned in the textbook I read yesterday.");
  assert.equal(book.kind, "silent");
  assert.equal(book.silentReason, "no_atom");
  assert.deepEqual(book.signals, []);

  const lamp = await detect("The Klarna lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);

  const mobile = await detect("Please send 500 kr via MobilePay today, I ship tomorrow.");
  assert.equal(mobile.kind, "risk");
  assert.equal(mobile.level, "high");
  assert.deepEqual(mobile.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(mobile.deal.amount, 500);

  const afterpay = await detect("Please send 500 kr via Afterpay today, I ship tomorrow.");
  assert.equal(afterpay.kind, "risk");
  assert.equal(afterpay.level, "high");
  assert.deepEqual(afterpay.signals, ["off_platform", "ship_before_meet"]);

  const wechat = await detect("Please send 500 kr via WeChat today, I ship tomorrow.");
  assert.equal(wechat.kind, "silent");
  assert.equal(wechat.silentReason, "weak_only");
  assert.deepEqual(wechat.signals, ["ship_before_meet"]);
});
