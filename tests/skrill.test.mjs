import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("Skrill and Interac with money are off-platform, a bare name is not", async () => {
  const skrillShip = await detect("Please send 500 kr via Skrill today, I ship tomorrow.");
  assert.equal(skrillShip.kind, "risk");
  assert.equal(skrillShip.level, "high");
  assert.deepEqual(skrillShip.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(skrillShip.deal.amount, 500);
  assert.equal(skrillShip.deal.currency, "DKK");

  const skrillReady = await detect("Please send 500 kr via Skrill today, the bike is ready.");
  assert.equal(skrillReady.kind, "risk");
  assert.equal(skrillReady.level, "medium");
  assert.deepEqual(skrillReady.signals, ["off_platform"]);
  assert.equal(skrillReady.deal.amount, 500);
  assert.equal(skrillReady.deal.currency, "DKK");

  const interacShip = await detect("Please send 500 kr via Interac today, I ship tomorrow.");
  assert.equal(interacShip.kind, "risk");
  assert.equal(interacShip.level, "high");
  assert.deepEqual(interacShip.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(interacShip.deal.amount, 500);

  const interacReady = await detect("Please send 500 kr via Interac today, the bike is ready.");
  assert.equal(interacReady.kind, "risk");
  assert.equal(interacReady.level, "medium");
  assert.deepEqual(interacReady.signals, ["off_platform"]);
  assert.equal(interacReady.deal.amount, 500);

  const skrillPickup = await detect("Please send 500 kr via Skrill today, or you can pick it up.");
  assert.equal(skrillPickup.kind, "risk");
  assert.equal(skrillPickup.level, "medium");
  assert.deepEqual(skrillPickup.signals, ["off_platform"]);

  const town = await detect("Skrill is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);

  const word = await detect("Interac is a word I saw in a book last year.");
  assert.equal(word.kind, "silent");
  assert.equal(word.silentReason, "no_atom");
  assert.deepEqual(word.signals, []);

  const mobile = await detect("Please send 500 kr via MobilePay today, I ship tomorrow.");
  assert.equal(mobile.kind, "risk");
  assert.equal(mobile.level, "high");
  assert.ok(mobile.signals.includes("off_platform"));
  assert.ok(mobile.signals.includes("ship_before_meet"));

  const mobilePickup = await detect("Please send 500 kr via MobilePay today, or you can pick it up.");
  assert.equal(mobilePickup.kind, "risk");
  assert.equal(mobilePickup.level, "medium");
  assert.deepEqual(mobilePickup.signals, ["off_platform"]);
});
