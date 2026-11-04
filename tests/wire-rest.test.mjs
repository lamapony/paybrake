import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("wire and transfer to the other bank wordings are off-platform", async () => {
  const high = [
    "Please wire 500 kr to our bank, I ship tomorrow.",
    "Please transfer 500 kr to the bank account, I ship tomorrow."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.ok(verdict.signals.includes("off_platform"), text);
    assert.ok(verdict.signals.includes("ship_before_meet"), text);
    assert.equal(verdict.deal.amount, 500, text);
  }

  const medium = [
    "Please wire 500 kr to our bank today, the bike is ready.",
    "Please transfer 500 kr to your account, the bike is ready.",
    "Overfør 500 kr til min konto, jeg sender i morgen.",
    "Överför 500 kr till mitt konto, jag skickar imorgon."
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
    assert.equal(verdict.deal.amount, 500, text);
  }
});

test("my bank stays high and the non-asks stay quiet", async () => {
  const mine = await detect("Please wire 500 kr to my bank, I ship tomorrow.");
  assert.equal(mine.kind, "risk");
  assert.equal(mine.level, "high");
  assert.ok(mine.signals.includes("off_platform"));
  assert.ok(mine.signals.includes("ship_before_meet"));
  assert.equal(mine.deal.amount, 500);
  assert.ok(mine.evidence.some((span) => span.text === "wire 500 kr to my bank"));

  const quiet = [
    "Please transfer the file to my bank tomorrow.",
    "Skriv til min konto når du har tid i næste uge.",
    "Jeg overførte pengene til min konto i går."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }

  const closed = await detect("The bank account was closed last year.");
  assert.equal(closed.kind, "silent");
  assert.equal(closed.silentReason, "weak_only");
  assert.deepEqual(closed.signals, ["account_threat"]);
  assert.equal(closed.signals.includes("off_platform"), false);
});
