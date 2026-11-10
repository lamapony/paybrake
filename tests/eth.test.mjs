import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("ETH with money is off-platform, and a topic is not", async () => {
  const shipText = "Please send 500 kr in ETH, I ship tomorrow.";
  const ship = await detect(shipText);
  assert.equal(ship.kind, "risk");
  assert.equal(ship.level, "high");
  assert.deepEqual(ship.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(ship.deal.amount, 500);
  assert.equal(ship.deal.currency, "DKK");
  assert.ok(findAtoms(shipText).some((hit) => hit.atom === "off_platform" && hit.text === "ETH" && hit.gate === "eth"));

  const bike = await detect("Send 500 kr in ETH, the bike is ready.");
  assert.equal(bike.kind, "risk");
  assert.equal(bike.level, "medium");
  assert.deepEqual(bike.signals, ["off_platform"]);
  assert.equal(bike.deal.amount, 500);
  assert.equal(bike.deal.currency, "DKK");

  const pickup = await detect("Send 500 kr in ETH, or you can pick it up.");
  assert.equal(pickup.kind, "risk");
  assert.equal(pickup.level, "medium");
  assert.deepEqual(pickup.signals, ["off_platform"]);
  assert.equal(pickup.signals.includes("ship_before_meet"), false);
  assert.equal(pickup.deal.amount, 500);

  const tokenText = "Please send 500 ETH, I ship tomorrow.";
  const token = await detect(tokenText);
  assert.equal(token.kind, "risk");
  assert.equal(token.level, "high");
  assert.deepEqual(token.signals, ["off_platform", "ship_before_meet"]);
  assert.equal(token.deal.amount, null);
  assert.ok(findAtoms(tokenText).some((hit) => hit.atom === "off_platform" && hit.text === "ETH" && hit.gate === "eth"));

  const file = await detect("Please send the file in ETH tomorrow.");
  assert.equal(file.kind, "silent");
  assert.equal(file.silentReason, "no_atom");
  assert.deepEqual(file.signals, []);
  assert.equal(file.deal.amount, null);

  const topic = await detect("ETH is a token I read about yesterday with my sister.");
  assert.equal(topic.kind, "silent");
  assert.equal(topic.silentReason, "no_atom");
  assert.deepEqual(topic.signals, []);

  const lamp = await detect("The ETH lamp is ready when you pick it up on Thursday.");
  assert.equal(lamp.kind, "silent");
  assert.ok(lamp.silentReason === "veto" || lamp.silentReason === "no_atom");
  assert.deepEqual(lamp.signals, []);
});

test("Bitcoin, USDT, USDC, and Ethereum with 500 kr and ship stay high", async () => {
  for (const text of [
    "Please send 500 kr in Bitcoin, I ship tomorrow.",
    "Please send 500 kr in USDT, I ship tomorrow.",
    "Please send 500 kr in USDC, I ship tomorrow.",
    "Please send 500 kr in Ethereum, I ship tomorrow."
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.ok(verdict.signals.includes("off_platform"), text);
    assert.ok(verdict.signals.includes("ship_before_meet"), text);
    assert.equal(verdict.deal.amount, 500, text);
  }
});
