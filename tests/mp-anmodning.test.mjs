import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("MobilePay-anmodning with 500 kr is off-platform, and jeg sender is not a ship", async () => {
  const asks = [
    "Jeg sender en MobilePay-anmodning på 500 kr, jeg sender cyklen i morgen.",
    "Jeg sender en MobilePay-anmodning på 500 kr, cyklen er klar.",
    "Jeg sender en MobilePay-anmodning på 500 kr, eller du kan hente den."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.signals.includes("ship_before_meet"), false, text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.equal(verdict.deal.currency, "DKK", text);
    assert.equal(verdict.rulesVersion, 5, text);
    assert.ok(
      findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === "MobilePay-anmodning" && hit.gate === "amount-near"),
      text
    );
    assert.equal(findAtoms(text).some((hit) => hit.atom === "ship_before_meet"), false, text);
  }
});

test("a MobilePay request without a sum, and a textbook mention, stay silent", async () => {
  const quiet = [
    "Jeg sender en MobilePay-anmodning i morgen, cyklen er klar.",
    "MobilePay-anmodning står i lærebogen, jeg læste i går."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
    assert.deepEqual(verdict.evidence, [], text);
    assert.equal(verdict.deal.amount, null, text);
    assert.equal(findAtoms(text).some((hit) => hit.atom === "off_platform"), false, text);
  }
});

test("anmodning without MobilePay stays silent, and anmodning i MobilePay with Send stays medium", async () => {
  const bare = await detect("Jeg laver en anmodning på 500 kr, cyklen er klar.");
  assert.equal(bare.kind, "silent");
  assert.equal(bare.silentReason, "no_atom");
  assert.deepEqual(bare.signals, []);
  assert.equal(bare.deal.amount, 500);
  assert.equal(findAtoms("Jeg laver en anmodning på 500 kr, cyklen er klar.").some((hit) => hit.atom === "off_platform"), false);

  const inside = "Send 500 kr, jeg laver en anmodning i MobilePay, jeg sender cyklen i morgen.";
  const verdict = await detect(inside);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["off_platform"]);
  assert.equal(verdict.signals.includes("ship_before_meet"), false);
  assert.equal(verdict.deal.amount, 500);
  assert.equal(verdict.deal.currency, "DKK");
  assert.ok(verdict.evidence.some((hit) => hit.atom === "off_platform" && hit.text === "MobilePay"));
  assert.ok(findAtoms(inside).some((hit) => hit.atom === "off_platform" && hit.text === "MobilePay" && hit.gate === "mobilepay"));
});

test("via MobilePay with ship stays high, and the MobilePay lamp stays a veto", async () => {
  const via = await detect("Please send 500 kr via MobilePay, I ship tomorrow.");
  assert.equal(via.kind, "risk");
  assert.equal(via.level, "high");
  assert.deepEqual(via.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(via.deal.amount, 500);
  assert.equal(via.deal.currency, "DKK");
  assert.ok(via.evidence.some((hit) => hit.text === "MobilePay"));
  assert.ok(via.evidence.some((hit) => hit.atom === "ship_before_meet"));

  const lamp = await detect("The MobilePay lamp is ready when you pick it up.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
  assert.deepEqual(lamp.evidence, []);
  assert.equal(findAtoms("The MobilePay lamp is ready when you pick it up.").some((hit) => hit.atom === "off_platform"), false);
});
