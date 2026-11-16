import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Vippse as a verb with an amount is off-platform", async () => {
  const asks = [
    "Vippse meg 500 kr, jeg sender i morgen.",
    "Vippse meg 500 kr, sykkelen er klar.",
    "Vippse 500 kr, eller du kan hente den."
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
    assert.ok(findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === "Vippse" && hit.gate === "local-rail"), text);
    assert.equal(findAtoms(text).some((hit) => hit.atom === "ship_before_meet"), false, text);
  }
});

test("via Vipps with ship stays high", async () => {
  const text = "Send 500 kr via Vipps, I ship tomorrow.";
  const verdict = await detect(text);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(verdict.deal.amount, 500);
  assert.equal(verdict.deal.currency, "DKK");
  assert.ok(verdict.evidence.some((span) => span.atom === "off_platform" && span.text === "Vipps"));
  assert.ok(verdict.evidence.some((span) => span.atom === "ship_before_meet" && span.text === "I ship tomorrow"));
});

test("a Vippse town and a Vippse lamp stay silent", async () => {
  const townText = "Vippse is a town I visited last summer with my sister.";
  const town = await detect(townText);
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);
  assert.deepEqual(town.evidence, []);
  assert.equal(findAtoms(townText).some((hit) => hit.atom === "off_platform"), false);

  const lampText = "The Vippse lamp is ready when you pick it up on Thursday.";
  const lamp = await detect(lampText);
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
  assert.deepEqual(lamp.evidence, []);
});

test("Swish and Swisha as verbs stay off-platform", async () => {
  for (const [text, rail] of [
    ["Swish 500 kr, jeg sender i morgen.", "Swish"],
    ["Swisha 500 kr, jeg sender i morgen.", "Swisha"]
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.signals.includes("ship_before_meet"), false, text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.ok(findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === rail), text);
  }
});
