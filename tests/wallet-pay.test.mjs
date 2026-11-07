import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("Apple Pay and Google Pay with money are off-platform, a mention without a sum is not", async () => {
  const appleShip = await detect("Please send 500 kr via Apple Pay today, I ship tomorrow.");
  assert.equal(appleShip.kind, "risk");
  assert.equal(appleShip.level, "high");
  assert.deepEqual(appleShip.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(appleShip.deal.amount, 500);
  assert.equal(appleShip.deal.currency, "DKK");

  const appleBike = await detect("Please send 500 kr via Apple Pay today, the bike is ready.");
  assert.equal(appleBike.kind, "risk");
  assert.equal(appleBike.level, "medium");
  assert.deepEqual(appleBike.signals, ["off_platform"]);
  assert.equal(appleBike.deal.amount, 500);
  assert.equal(appleBike.deal.currency, "DKK");

  const applePickup = await detect("Please send 500 kr via Apple Pay today, or you can pick it up.");
  assert.equal(applePickup.kind, "risk");
  assert.equal(applePickup.level, "medium");
  assert.deepEqual(applePickup.signals, ["off_platform"]);
  assert.equal(applePickup.signals.includes("ship_before_meet"), false);

  const googleShip = await detect("Please send 500 kr with Google Pay today, I ship tomorrow.");
  assert.equal(googleShip.kind, "risk");
  assert.equal(googleShip.level, "high");
  assert.deepEqual(googleShip.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(googleShip.deal.amount, 500);

  const googleBike = await detect("Please send 500 kr via Google Pay today, the bike is ready.");
  assert.equal(googleBike.kind, "risk");
  assert.equal(googleBike.level, "medium");
  assert.deepEqual(googleBike.signals, ["off_platform"]);
  assert.equal(googleBike.deal.amount, 500);
  assert.equal(googleBike.deal.currency, "DKK");

  const googlePickup = await detect("Please send 500 kr with Google Pay today, or you can pick it up.");
  assert.equal(googlePickup.kind, "risk");
  assert.equal(googlePickup.level, "medium");
  assert.deepEqual(googlePickup.signals, ["off_platform"]);
  assert.equal(googlePickup.signals.includes("ship_before_meet"), false);

  const tickets = await detect("I paid with Apple Pay yesterday for the museum tickets.");
  assert.equal(tickets.kind, "silent");
  assert.equal(tickets.silentReason, "no_atom");
  assert.deepEqual(tickets.signals, []);

  const appleBook = await detect("Apple Pay is mentioned in the textbook I read yesterday.");
  assert.equal(appleBook.kind, "silent");
  assert.equal(appleBook.silentReason, "no_atom");
  assert.deepEqual(appleBook.signals, []);

  const googleBook = await detect("Google Pay is mentioned in the textbook I read yesterday.");
  assert.equal(googleBook.kind, "silent");
  assert.equal(googleBook.silentReason, "no_atom");
  assert.deepEqual(googleBook.signals, []);

  const pie = await detect("The apple pie is ready when you pick it up on Thursday.");
  assert.equal(pie.kind, "silent");
  assert.equal(pie.silentReason, "veto");
  assert.deepEqual(pie.signals, []);

  const appleGiftShip = await detect("Send an Apple gift card of 500 kr, I ship tomorrow.");
  assert.equal(appleGiftShip.kind, "risk");
  assert.equal(appleGiftShip.level, "high");
  assert.ok(appleGiftShip.signals.includes("off_platform"));
  assert.ok(appleGiftShip.signals.includes("ship_before_meet"));

  const googlePlayShip = await detect("Send a Google Play card of 500 kr, I ship tomorrow.");
  assert.equal(googlePlayShip.kind, "risk");
  assert.equal(googlePlayShip.level, "high");
  assert.ok(googlePlayShip.signals.includes("off_platform"));
  assert.ok(googlePlayShip.signals.includes("ship_before_meet"));

  const appleGiftPickup = await detect("Send an Apple gift card of 500 kr today, or you can pick it up.");
  assert.equal(appleGiftPickup.kind, "risk");
  assert.equal(appleGiftPickup.level, "medium");
  assert.deepEqual(appleGiftPickup.signals, ["off_platform"]);
  assert.equal(appleGiftPickup.signals.includes("ship_before_meet"), false);
});
