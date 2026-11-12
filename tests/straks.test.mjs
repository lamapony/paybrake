import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("straksoverførsel with 500 kr is off-platform, and jeg sender is not a ship", async () => {
  const asks = [
    "Lav en straksoverførsel på 500 kr til mig, jeg sender cyklen i morgen.",
    "Lav en straksoverførsel på 500 kr, cyklen er klar.",
    "Lav en straksoverførsel på 500 kr til mig, eller du kan hente den."
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
      findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === "straksoverførsel" && hit.gate === "amount-near"),
      text
    );
    assert.equal(findAtoms(text).some((hit) => hit.atom === "ship_before_meet"), false, text);
  }
});

test("a straksoverførsel without a sum, and a textbook mention, stay silent", async () => {
  const quiet = [
    "Lav en straksoverførsel i morgen, cyklen er klar.",
    "Straksoverførsel står i lærebogen, jeg læste i går."
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

test("the straksoverførsel lamp stays a veto, and bankoverførsel with 500 kr stays medium", async () => {
  const lamp = await detect("The straksoverførsel lamp is ready when you pick it up.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
  assert.deepEqual(lamp.evidence, []);
  assert.equal(findAtoms("The straksoverførsel lamp is ready when you pick it up.").some((hit) => hit.atom === "off_platform"), false);

  const bank = "Lav en bankoverførsel på 500 kr, jeg sender i morgen.";
  const verdict = await detect(bank);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["off_platform"]);
  assert.equal(verdict.signals.includes("ship_before_meet"), false);
  assert.equal(verdict.deal.amount, 500);
  assert.equal(verdict.deal.currency, "DKK");
  assert.ok(verdict.evidence.some((hit) => hit.atom === "off_platform" && hit.text === "bankoverførsel"));
  assert.ok(findAtoms(bank).some((hit) => hit.atom === "off_platform" && hit.text === "bankoverførsel" && hit.gate === "negation"));
  assert.equal(findAtoms(bank).some((hit) => hit.atom === "ship_before_meet"), false);
});
