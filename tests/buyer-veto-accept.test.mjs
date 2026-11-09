import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

function thread(messages) {
  return detect(messages.map((m) => m.text).join("\n"), { messages });
}

test("a seller who says Sure to checkout and then asks for F&F still gets a card", async () => {
  const later = await thread([
    { from: "buyer", text: "Can I pay through the checkout?" },
    { from: "seller", text: "Sure." },
    { from: "seller", text: "Actually checkout is broken, send 500 kr via PayPal F&F, I ship tomorrow." }
  ]);
  assert.equal(later.kind, "risk");
  assert.equal(later.level, "high");
  assert.ok(later.signals.includes("friends_family"));

  const nextTurn = await thread([
    { from: "buyer", text: "Can I pay through the checkout?" },
    { from: "seller", text: "Ok" },
    { from: "buyer", text: "Great, how?" },
    { from: "seller", text: "Send 500 kr via PayPal Friends and Family first, I ship tomorrow." }
  ]);
  assert.equal(nextTurn.kind, "risk");
});

test("a seller who accepts the buyer's checkout and asks nothing else stays silent", async () => {
  const verdict = await thread([
    { from: "buyer", text: "Can I pay through the checkout?" },
    { from: "seller", text: "Sure thing." }
  ]);
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "veto");
});
