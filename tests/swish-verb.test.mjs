import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Swish, Swisha, and Vipps as a verb with an amount are off-platform", async () => {
  const asks = [
    ["Swish 500 kr, jeg sender i morgen.", "Swish"],
    ["Swisha 500 kr, jeg sender i morgen.", "Swisha"],
    ["Vipps 500 kr, jeg sender i morgen.", "Vipps"]
  ];
  for (const [text, rail] of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.signals.includes("ship_before_meet"), false, text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.equal(verdict.deal.currency, "DKK", text);
    assert.equal(verdict.rulesVersion, 5, text);
    assert.ok(findAtoms(text).some((hit) => hit.atom === "off_platform" && hit.text === rail && hit.gate === "local-rail"), text);
  }
});

test("via Swish and via Vipps with ship stay high", async () => {
  for (const text of [
    "Send 500 kr via Swish, I ship tomorrow.",
    "Send 500 kr via Vipps, I ship tomorrow."
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"], text);
    assert.equal(verdict.deal.amount, 500, text);
    assert.equal(verdict.deal.currency, "DKK", text);
  }
});

test("a Swish town and a Swish lamp stay silent", async () => {
  const town = await detect("Swish is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);
  assert.deepEqual(town.evidence, []);
  assert.equal(findAtoms("Swish is a town I visited last summer with my sister.").some((hit) => hit.atom === "off_platform"), false);

  const lamp = await detect("The Swish lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
  assert.deepEqual(lamp.evidence, []);
});

test("a rail listing, a pickup, and a Swedish hold stay quiet", async () => {
  const quiet = [
    ["Betalning via Swish, 500 kr", "no_atom"],
    ["Betaling med Vipps, 500 kr", "no_atom"],
    ["Payment by Swish or cash, price 500 kr.", "no_atom"],
    ["Swish 500 kr at pickup, no payment before we meet.", "veto"],
    ["Swisha 500 kr nu så håller jag den, hämta på lördag.", "no_atom"],
    ["Swish me now, we can meet tomorrow afternoon.", "no_atom"],
    ["Vipps me now, we can meet tomorrow afternoon.", "no_atom"],
    ["I was swishing the chain on this 500 kr bike yesterday.", "no_atom"],
    ["I heard a swish when the bike chain moved on Thursday.", "no_atom"],
    ["Swish 500 kr. Hentes i Aarhus på torsdag eftermiddag.", "no_atom"]
  ];
  for (const [text, reason] of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, reason, text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
    assert.deepEqual(verdict.signals, [], text);
  }
});
