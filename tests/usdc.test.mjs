import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("USDC with money is off-platform and a topic is not", async () => {
  const shipped = await detect("Send 500 kr in USDC, I ship tomorrow.");
  assert.equal(shipped.kind, "risk");
  assert.equal(shipped.level, "high");
  assert.ok(shipped.signals.includes("off_platform"));
  assert.ok(shipped.signals.includes("ship_before_meet"));
  assert.equal(shipped.deal.amount, 500);

  const ready = await detect("Send 500 kr in USDC, the bike is ready.");
  assert.equal(ready.kind, "risk");
  assert.equal(ready.level, "medium");
  assert.deepEqual(ready.signals, ["off_platform"]);
  assert.equal(ready.deal.amount, 500);

  const token = await detect("Send 500 USDC, I ship tomorrow.");
  assert.equal(token.kind, "risk");
  assert.equal(token.level, "high");
  assert.ok(token.signals.includes("off_platform"));
  assert.ok(token.signals.includes("ship_before_meet"));

  const topic = await detect("USDC is a token I read about yesterday with my sister.");
  assert.equal(topic.kind, "silent");
  assert.equal(topic.silentReason, "no_atom");
  assert.deepEqual(topic.signals, []);

  const paper = await detect("Send the USDC whitepaper to my sister tomorrow.");
  assert.equal(paper.kind, "silent");
  assert.equal(paper.silentReason, "no_atom");
  assert.deepEqual(paper.signals, []);
});

test("USDT stays high and a Bitcoin topic keeps its old signal tail", async () => {
  const usdt = await detect("Send 500 kr in USDT, I ship tomorrow.");
  assert.equal(usdt.kind, "risk");
  assert.equal(usdt.level, "high");
  assert.ok(usdt.signals.includes("off_platform"));
  assert.ok(usdt.signals.includes("ship_before_meet"));
  assert.equal(usdt.deal.amount, 500);

  const bitcoin = await detect("Bitcoin is a topic I read about yesterday with my sister.");
  assert.equal(bitcoin.kind, "silent");
  assert.equal(bitcoin.silentReason, "no_atom");
  assert.ok(bitcoin.signals.includes("off_platform"));
  assert.ok(bitcoin.evidence.some((span) => span.text === "Bitcoin"));
});
