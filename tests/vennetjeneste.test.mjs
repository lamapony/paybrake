import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("som vennetjeneste with an amount is friends and family", async () => {
  const shipText = "Send 500 kr som vennetjeneste via PayPal, jeg kan kun sende varen.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.ok(ship.signals.includes("friends_family"));
  assert.ok(ship.signals.includes("ship_before_meet"));
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(ship.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "kan kun sende"));
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "friends_family" && /vennetjeneste/i.test(hit.text)));

  const bike = await detect("Send 500 kr som vennetjeneste via PayPal, cyklen er klar.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["friends_family"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.signals.includes("ship_before_meet"), false);

  const pickup = await detect("Send 500 kr som vennetjeneste, eller du kan hente den.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["friends_family"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const book = await detect("Vennetjeneste står i lærebogen, jeg læste i går.");
  assert.equal(book.kind, "silent");
  assert.equal(book.silentReason, "no_atom");
  assert.deepEqual(book.signals, []);
});

test("som familieoverførsel with an amount is friends and family, and jeg sender is not a ship", async () => {
  const sender = await detect("Send 500 kr som familieoverførsel, jeg sender i morgen.");
  assert.equal(sender.kind, "risk");
  assert.equal(sender.level, "medium");
  assert.deepEqual(sender.signals, ["friends_family"]);
  assert.equal(sender.deal.amount, 500);
  assert.equal(sender.deal.currency, "DKK");
  assert.equal(sender.signals.includes("ship_before_meet"), false);

  const bike = await detect("Send 500 kr som familieoverførsel, cyklen er klar.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["friends_family"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.signals.includes("ship_before_meet"), false);

  const pickup = await detect("Send 500 kr som familieoverførsel, eller du kan hente den.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["friends_family"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const book = await detect("Familieoverførsel står i lærebogen, jeg læste i går.");
  assert.equal(book.kind, "silent");
  assert.equal(book.silentReason, "no_atom");
  assert.deepEqual(book.signals, []);
});

test("som gave with ship stays high", async () => {
  const gave = await detect("Send 500 kr som gave via PayPal, jeg kan kun sende varen.");
  assert.equal(gave.kind, "risk");
  assert.equal(gave.level, "high");
  assert.deepEqual(gave.signals, ["friends_family", "ship_before_meet"]);
  assert.equal(gave.deal.amount, 500);
  assert.ok(gave.evidence.some((span) => span.atom === "friends_family"));
  assert.ok(gave.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "kan kun sende"));
});
