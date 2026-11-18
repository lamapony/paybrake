import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms, RULES_VERSION } = atoms;

const NAMES = [
  "WeChat",
  "Paytm",
  "Bancontact",
  "SEPA",
  "WorldRemit",
  "Remitly",
  "Ria",
  "Paysend",
  "Solana",
  "XRP",
  "Litecoin",
  "Neteller"
];

function offPlatform(text, rail) {
  return findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === rail && hit.gate === "amount-near");
}

test("the remaining named rails with an amount are off-platform", async () => {
  assert.equal(RULES_VERSION, 5);
  for (const name of NAMES) {
    const shipText = `Please send 500 kr via ${name} today, I ship tomorrow.`;
    const ship = await detect(shipText);
    assert.equal(ship.kind, "risk", shipText);
    assert.equal(ship.level, "high", shipText);
    assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"], shipText);
    assert.equal(ship.deal.amount, 500, shipText);
    assert.equal(ship.deal.currency, "DKK", shipText);
    assert.equal(ship.rulesVersion, 5, shipText);
    assert.ok(ship.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "I ship tomorrow"), shipText);
    assert.ok(offPlatform(shipText, name), shipText);

    const bikeText = `Please send 500 kr via ${name} today, the bike is ready.`;
    const bike = await detect(bikeText);
    assert.equal(bike.kind, "risk", bikeText);
    assert.equal(bike.level, "medium", bikeText);
    assert.deepEqual(bike.signals, ["off_platform"], bikeText);
    assert.equal(bike.signals.includes("ship_before_meet"), false, bikeText);
    assert.equal(bike.deal.amount, 500, bikeText);
    assert.equal(bike.deal.currency, "DKK", bikeText);
    assert.ok(offPlatform(bikeText, name), bikeText);

    const pickupText = `Please send 500 kr via ${name} today, or you can pick it up.`;
    const pickup = await detect(pickupText);
    assert.equal(pickup.kind, "risk", pickupText);
    assert.equal(pickup.level, "medium", pickupText);
    assert.deepEqual(pickup.signals, ["off_platform"], pickupText);
    assert.equal(pickup.signals.includes("ship_before_meet"), false, pickupText);
    assert.equal(pickup.deal.amount, 500, pickupText);
    assert.ok(offPlatform(pickupText, name), pickupText);

    const fileText = `Please send the file via ${name} tomorrow.`;
    const file = await detect(fileText);
    assert.equal(file.kind, "silent", fileText);
    assert.equal(file.silentReason, "no_atom", fileText);
    assert.deepEqual(file.signals, [], fileText);
    assert.equal(file.deal.amount, null, fileText);
    assert.equal(findAtoms(fileText).some((hit) => hit.atom === "off_platform"), false, fileText);

    const townText = `${name} is a town I visited last summer with my sister.`;
    const town = await detect(townText);
    assert.equal(town.kind, "silent", townText);
    assert.equal(town.silentReason, "no_atom", townText);
    assert.deepEqual(town.signals, [], townText);
    assert.equal(findAtoms(townText).some((hit) => hit.atom === "off_platform"), false, townText);

    const lampText = `The ${name} lamp is ready when you pick it up on Thursday.`;
    const lamp = await detect(lampText);
    assert.equal(lamp.kind, "silent", lampText);
    assert.equal(lamp.silentReason, "veto", lampText);
    assert.deepEqual(lamp.signals, [], lampText);
  }
});

test("via BLIK and via iDEAL with an amount are off-platform, and a bare name is not", async () => {
  for (const name of ["BLIK", "iDEAL"]) {
    const shipText = `Please send 500 kr via ${name} today, I ship tomorrow.`;
    const ship = await detect(shipText);
    assert.equal(ship.kind, "risk", shipText);
    assert.equal(ship.level, "high", shipText);
    assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"], shipText);
    assert.equal(ship.deal.amount, 500, shipText);
    assert.equal(ship.deal.currency, "DKK", shipText);
    assert.ok(ship.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "I ship tomorrow"), shipText);
    assert.ok(offPlatform(shipText, `via ${name}`), shipText);

    const bikeText = `Please send 500 kr via ${name} today, the bike is ready.`;
    const bike = await detect(bikeText);
    assert.equal(bike.kind, "risk", bikeText);
    assert.equal(bike.level, "medium", bikeText);
    assert.deepEqual(bike.signals, ["off_platform"], bikeText);
    assert.equal(bike.signals.includes("ship_before_meet"), false, bikeText);
    assert.equal(bike.deal.amount, 500, bikeText);
    assert.ok(offPlatform(bikeText, `via ${name}`), bikeText);

    const pickupText = `Please send 500 kr via ${name} today, or you can pick it up.`;
    const pickup = await detect(pickupText);
    assert.equal(pickup.kind, "risk", pickupText);
    assert.equal(pickup.level, "medium", pickupText);
    assert.deepEqual(pickup.signals, ["off_platform"], pickupText);
    assert.equal(pickup.signals.includes("ship_before_meet"), false, pickupText);
    assert.equal(pickup.deal.amount, 500, pickupText);
    assert.ok(offPlatform(pickupText, `via ${name}`), pickupText);

    const fileText = `Please send the file via ${name} tomorrow.`;
    const file = await detect(fileText);
    assert.equal(file.kind, "silent", fileText);
    assert.equal(file.silentReason, "no_atom", fileText);
    assert.deepEqual(file.signals, [], fileText);
    assert.equal(file.deal.amount, null, fileText);
    assert.equal(findAtoms(fileText).some((hit) => hit.atom === "off_platform"), false, fileText);

    const townText = `${name} is a town I visited last summer with my sister.`;
    const town = await detect(townText);
    assert.equal(town.kind, "silent", townText);
    assert.equal(town.silentReason, "no_atom", townText);
    assert.deepEqual(town.signals, [], townText);
    assert.equal(findAtoms(townText).some((hit) => hit.atom === "off_platform"), false, townText);

    const lampText = `The ${name} lamp is ready when you pick it up on Thursday.`;
    const lamp = await detect(lampText);
    assert.equal(lamp.kind, "silent", lampText);
    assert.equal(lamp.silentReason, "veto", lampText);
    assert.deepEqual(lamp.signals, [], lampText);
  }
});

test("BLIK and iDEAL stay inside the allowed prefixes", async () => {
  const prefixed = [
    ["Send 500 kr med BLIK, cyklen er klar.", "med BLIK"],
    ["Send 500 kr på BLIK, cyklen er klar.", "på BLIK"],
    ["Send 500 kr on BLIK today, the bike is ready.", "on BLIK"],
    ["Send 500 kr with BLIK today, the bike is ready.", "with BLIK"],
    ["Send 500 kr på iDEAL, cyklen er klar.", "på iDEAL"],
    ["Send 500 kr on iDEAL today, the bike is ready.", "on iDEAL"],
    ["Send 500 kr with iDEAL today, the bike is ready.", "with iDEAL"]
  ];
  for (const [text, rail] of prefixed) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.signals.includes("ship_before_meet"), false, text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.ok(offPlatform(text, rail), text);
  }

  const medIdeal = "Send 500 kr med iDEAL, cyklen er klar.";
  const quiet = await detect(medIdeal);
  assert.equal(quiet.kind, "silent");
  assert.equal(quiet.silentReason, "no_atom");
  assert.deepEqual(quiet.signals, []);
  assert.equal(quiet.deal.amount, 500);
  assert.equal(findAtoms(medIdeal).some((hit) => hit.atom === "off_platform"), false);

  const blik = await detect("Send 500 kr i et blik, cyklen er klar.");
  assert.equal(blik.kind, "silent");
  assert.equal(blik.silentReason, "no_atom");
  assert.deepEqual(blik.signals, []);
  assert.equal(blik.deal.amount, 500);
  assert.equal(findAtoms("Send 500 kr i et blik, cyklen er klar.").some((hit) => hit.atom === "off_platform"), false);

  const idealText = "This is an ideal price, 500 kr, I ship tomorrow.";
  const ideal = await detect(idealText);
  assert.equal(ideal.kind, "silent");
  assert.equal(ideal.silentReason, "weak_only");
  assert.deepEqual(ideal.signals, ["ship_before_meet"]);
  assert.equal(ideal.deal.amount, 500);
  assert.equal(findAtoms(idealText).some((hit) => hit.atom === "off_platform"), false);
});

test("short fragments and Maria are not the new rails", async () => {
  const ltcText = "Please send 500 kr via LTC today, I ship tomorrow.";
  const ltc = await detect(ltcText);
  assert.equal(ltc.kind, "risk");
  assert.equal(ltc.level, "high");
  assert.deepEqual(ltc.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ltc.deal.amount, 500);
  assert.equal(ltc.deal.currency, "DKK");
  assert.ok(offPlatform(ltcText, "LTC"));

  for (const text of [
    "Please send 500 kr via we today, I ship tomorrow.",
    "Please send 500 kr via pay today, I ship tomorrow.",
    "Please send 500 kr via sol today, I ship tomorrow.",
    "Please send 500 kr via separate today, I ship tomorrow.",
    "Please send 500 kr via altcoin today, I ship tomorrow."
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "weak_only", text);
    assert.deepEqual(verdict.signals, ["ship_before_meet"], text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.equal(findAtoms(text).some((hit) => hit.atom === "off_platform"), false, text);
  }

  const mariaText = "Maria sends 500 kr tomorrow for the bike.";
  const maria = await detect(mariaText);
  assert.equal(maria.kind, "silent");
  assert.equal(maria.silentReason, "no_atom");
  assert.deepEqual(maria.signals, []);
  assert.equal(maria.deal.amount, 500);
  assert.equal(findAtoms(mariaText).some((hit) => hit.atom === "off_platform"), false);
});

test("Klarna, Bitcoin, bank transfer, and via PayPal keep their levels", async () => {
  for (const text of [
    "Please send 500 kr via Klarna today, I ship tomorrow.",
    "Please send 500 kr in Bitcoin, I ship tomorrow.",
    "Send 900 kr by bank transfer today, I ship tomorrow.",
    "Please send 500 kr via Alipay today, I ship tomorrow.",
    "Please send 500 kr via Trustly today, I ship tomorrow.",
    "Please send 500 kr via N26 today, I ship tomorrow."
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.ok(verdict.signals.includes("off_platform"), text);
    assert.ok(verdict.signals.includes("ship_before_meet"), text);
  }

  const paypalText = "Please send 500 kr via PayPal today, I ship tomorrow.";
  const paypal = await detect(paypalText);
  assert.equal(paypal.kind, "silent");
  assert.equal(paypal.silentReason, "weak_only");
  assert.deepEqual(paypal.signals, ["ship_before_meet"]);
  assert.equal(findAtoms(paypalText).some((hit) => hit.atom === "off_platform"), false);
});
