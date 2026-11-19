import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Swishe and Swisher as a verb with an amount are off-platform", async () => {
  const asks = [
    ["Swishe 500 kr, jeg sender i morgen.", "Swishe", 500],
    ["Swisher 500 kr, jeg sender i morgen.", "Swisher", 500],
    ["Swishe first, 400 kr, inden jeg poster den.", "Swishe", 400]
  ];
  for (const [text, rail, amount] of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.signals.includes("ship_before_meet"), false, text);
    assert.equal(verdict.deal.amount, amount, text);
    assert.equal(verdict.deal.currency, "DKK", text);
    assert.equal(verdict.rulesVersion, 5, text);
    assert.ok(findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === rail && hit.gate === "local-rail"), text);
  }
});

test("via Swishe with an amount and ship stays high", async () => {
  const text = "Send 500 kr via Swishe, I ship tomorrow.";
  const verdict = await detect(text);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(verdict.deal.amount, 500);
  assert.equal(verdict.deal.currency, "DKK");
  assert.ok(findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === "Swishe" && hit.gate === "local-rail"));
});

test("Swish and Swisha still match with an amount", async () => {
  for (const [text, rail] of [
    ["Swish 500 kr, jeg sender i morgen.", "Swish"],
    ["Swisha 500 kr, jeg sender i morgen.", "Swisha"]
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.ok(findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === rail && hit.gate === "local-rail"), text);
  }
});

test("a Swishe phrase without an amount stays on the local-rail gate", async () => {
  const quiet = [
    "Swishe me now, we can meet tomorrow afternoon.",
    "Swisher me now, we can meet tomorrow afternoon.",
    "I was swishing the chain on this 500 kr bike yesterday.",
    "I heard a swish when the bike chain moved on Thursday."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
    assert.equal(findAtoms(text).some((hit) => hit.atom === "off_platform"), false, text);
  }
});
