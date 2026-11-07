import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("using Wise and by Wise are off-platform, a town named Wise is not", async () => {
  const using = await detect("Please send 500 kr using Wise today, I ship tomorrow.");
  assert.equal(using.kind, "risk");
  assert.equal(using.level, "high");
  assert.deepEqual(using.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(using.deal.amount, 500);
  assert.equal(using.deal.currency, "DKK");
  assert.ok(using.evidence.some((span) => /using wise/i.test(span.text)));

  const by = await detect("Please send 500 kr by Wise today, I ship tomorrow.");
  assert.equal(by.kind, "risk");
  assert.equal(by.level, "high");
  assert.deepEqual(by.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(by.deal.amount, 500);
  assert.ok(by.evidence.some((span) => /by wise/i.test(span.text)));

  const through = await detect("Please send 500 kr through Wise today, I ship tomorrow.");
  assert.equal(through.kind, "risk");
  assert.equal(through.level, "high");
  assert.ok(through.signals.includes("off_platform"));
  assert.ok(through.signals.includes("ship_before_meet"));
  assert.ok(through.evidence.some((span) => /through wise/i.test(span.text)));

  const town = await detect("Wise is a town I visited last summer with my sister.");
  assert.equal(town.kind, "silent");
  assert.equal(town.silentReason, "no_atom");
  assert.deepEqual(town.signals, []);
});
