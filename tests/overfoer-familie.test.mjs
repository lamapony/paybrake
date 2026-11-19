import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("overfør som familieoverførsel is friends and family like send", async () => {
  const texts = [
    "Send 3000 kr som familieoverførsel, så holder jeg den.",
    "Overfør 3000 kr som familieoverførsel, så holder jeg den.",
    "Overfører 3000 kr som familieoverførsel, så holder jeg den.",
    "Overført 3000 kr som familieoverførsel, så holder jeg den.",
    "Overføre 3000 kr som familieoverførsel, så holder jeg den.",
    "Overfoer 3000 kr som familieoverførsel, så holder jeg den."
  ];
  for (const text of texts) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["friends_family"], text);
    assert.equal(verdict.deal.amount, 3000, text);
  }
});

test("overførte and a familieoverførsel with no amount stay silent", async () => {
  const texts = [
    "Overførte 3000 kr som familieoverførsel, så holder jeg den.",
    "Overfør billederne som familieoverførsel, så holder jeg den."
  ];
  for (const text of texts) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});
