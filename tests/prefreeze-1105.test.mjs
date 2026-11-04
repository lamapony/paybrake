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

// 2. MobilePay at the handover is the normal Danish pickup payment.
test("MobilePay at pickup stays quiet", async () => {
  const quiet = [
    "Hi! The bike is 1500 kr. You can come see it tomorrow and pay by MobilePay when you pick it up.",
    "You can pay with MobilePay when we meet, 1500 kr.",
    "Pris 1500 kr. Betaling med MobilePay ved afhentning.",
    "Det koster 1500 kr, du kan betale med MobilePay når du henter den.",
    "1500 kr, betal med MobilePay når vi mødes.",
    "Price 1500 kr. Pickup in Valby, pay with MobilePay on the spot."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
});

test("MobilePay before the handover still warns", async () => {
  const risky = [
    "Pay 500 kr deposit on MobilePay to 22334455 and I ship tomorrow.",
    "Send 1500 kr on MobilePay now, then you can pick it up.",
    "MobilePay 1500 kr to 22334455 first, I ship tomorrow.",
    "Send 500 kr depositum på MobilePay nu. Eller betal ved afhentning."
  ];
  for (const text of risky) await assertRisk(seller(text), text);
  const reserve = await seller("MobilePay 500 kr now to reserve it, pay the rest when you pick it up.");
  assert.equal(reserve.level, "high", JSON.stringify(reserve));
  assert.ok(reserve.signals.includes("off_platform"), JSON.stringify(reserve.signals));
});

// 3. "G&S fees are too high, use F&F" is the classic dodge. Naming G&S to
//    avoid it is not agreeing to it.
test("dodging Goods & Services fees is not a Goods & Services veto", async () => {
  const risky = [
    "Goods and Services fees are too high, send 900 kr via Friends & Family please.",
    "PayPal G&S adds fees so please send as F&F, 900 kr",
    "Send via F&F instead of G&S please, 900 kr",
    "G&S takes 5%, so pay 900 kr Friends and Family."
  ];
  for (const text of risky) await assertRisk(seller(text), text, "friends_family");
});

test("Goods & Services offered or agreed still hides the card", async () => {
  const quiet = [
    "Price is 900 kr. Pay with PayPal Goods and Services and I ship tomorrow.",
    "Pay with Goods & Services, not Friends and Family. 900 kr.",
    "Goods & Services is fine, I'll cover the fee. Not Friends and Family. 900 kr."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
});
