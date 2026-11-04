// Pre-freeze bug hunt (5 Nov). Each block is one small detection fix: the
// risky cases were missed on main, the quiet cases raised a card on main.
import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

function thread(messages, context = {}) {
  const text = messages.map((message) => message.text).join("\n");
  return payRisk.detect(text, { ...context, messages });
}

function seller(text) {
  return thread([{ from: "seller", text }]);
}

async function assertRisk(verdict, label, signal) {
  const v = await verdict;
  assert.equal(v.kind, "risk", label + " " + JSON.stringify(v));
  if (signal) assert.ok(v.signals.includes(signal), label + " " + JSON.stringify(v.signals));
}

async function assertSilent(verdict, label) {
  const v = await verdict;
  assert.equal(v.kind, "silent", label + " " + JSON.stringify(v));
}

// 1. The buyer's own line never raises a card, and it must not hide one
//    either: a buyer asking for checkout is not the seller agreeing to it.
test("a buyer asking for checkout or pickup does not hide the seller's ask", async () => {
  await assertRisk(thread([
    { from: "buyer", text: "Can I pay through the marketplace checkout?" },
    { from: "seller", text: "No, send 500 kr deposit via PayPal Friends & Family first." }
  ]), "buyer checkout", "friends_family");
  await assertRisk(thread([
    { from: "buyer", text: "I'd rather use the platform checkout." },
    { from: "seller", text: "MobilePay 1500 kr to 22334455 today and I ship tomorrow." }
  ]), "buyer platform checkout", "off_platform");
});

test("a seller who offers checkout still hides the card", async () => {
  await assertSilent(thread([
    { from: "buyer", text: "Can I send 500 kr via Friends & Family?" },
    { from: "seller", text: "Please pay through the marketplace checkout instead." }
  ]), "seller checkout");
  await assertSilent(thread([
    { from: "buyer", text: "How do I pay?" },
    { from: "seller", text: "Pay through the marketplace checkout, 900 kr. I ship tomorrow." }
  ]), "seller checkout + ship");
});
