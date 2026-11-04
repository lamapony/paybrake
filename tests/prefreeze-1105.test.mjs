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

// 4. A refused deposit and a bottle deposit are not an upfront ask.
test("a refused or bottle deposit stays quiet", async () => {
  const quiet = [
    "I won't ask for a deposit, pay when you pick it up.",
    "I don't need a deposit, just pay 900 kr when you pick it up.",
    "The deposit on the bottles is included. 20 kr."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
  await assertRisk(seller("I need a deposit of 500 kr before I hold it."), "need a deposit", "upfront_deposit");
});

// 5. "Payment first? No, ..." answers the question with a refusal.
test("a refused pay-first question stays quiet", async () => {
  await assertSilent(seller("Payment first? No, you can pay when you see it."), "refused question");
  await assertRisk(seller("Payment first, 900 kr, then I ship."), "pay first ask", "pay_before_see");
  await assertRisk(seller("Payment first? Yes, 900 kr and then I ship."), "yes pay first", "pay_before_see");
});

// 6. "I don't do G&S, only F&F" dictates the rail without a pay word.
test("refusing Goods & Services and dictating F&F only warns", async () => {
  await assertRisk(seller("I don't do Goods & Services, Friends & Family only."), "don't do", "friends_family");
  await assertRisk(seller("We don't accept G&S, Friends and Family only."), "don't accept", "friends_family");
  await assertRisk(seller("I only accept Friends and Family, 900 kr."), "only accept", "friends_family");
  await assertRisk(seller("Sorry, we take only PayPal F&F for this one."), "take only", "friends_family");
  // Unchanged: a separate sentence, or a refusal of F&F, stays quiet.
  await assertSilent(seller("Don't use the checkout. Friends and Family only."), "separate sentence");
  await assertSilent(seller("I don't only accept Friends and Family, Goods & Services is fine too."), "negated");
  await assertSilent(seller("I never accept Friends and Family payments, only Goods and Services."), "refused F&F");
});

// 7. Holding the item until the handover, paid at the handover, is not a deposit.
test("holding an item until pickup is not a deposit ask", async () => {
  await assertSilent(seller("I can hold it for you until Saturday, pay 900 kr when you pick it up."), "hold + pickup");
  await assertRisk(seller("Send 200 kr and I'll hold it for you until Saturday."), "hold for money", "upfront_deposit");
  await assertSilent(seller("I'll hold it for you until Saturday, no payment until you've seen it."), "hold, no payment");
  await assertSilent(seller("Jeg holder den til dig til lørdag, betal 900 kr ved afhentning."), "holder til dig + afhentning");
  await assertRisk(seller("Send 500 kr deposit on MobilePay now and I hold it for you, pay the rest when you pick it up."), "deposit now + hold", "upfront_deposit");
});

// 8. A bank transfer or Revolut at the handover is not off-platform pressure.
test("bank transfer or Revolut at the handover stays quiet", async () => {
  const quiet = [
    "Revolut or cash at pickup, 900 kr.",
    "Cash or bank transfer when you pick it up, 900 kr",
    "Kontant eller bankoverførsel ved afhentning, 900 kr.",
    "You can pay via Wise when we meet, 90 EUR."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
  const risky = [
    "Send 900 kr by bank transfer today, I ship tomorrow.",
    "Pay 900 kr on Revolut now and you can pick it up later.",
    "Send the 300 kr deposit by bank transfer today, pay the rest when you pick it up."
  ];
  for (const text of risky) await assertRisk(seller(text), text, "off_platform");
});

// 9. "Wire 500 USD first and I'll ship it": an amount sent first is pay-before-see.
test("an amount sent or paid first warns", async () => {
  const risky = [
    "Wire 500 USD first and I'll ship it.",
    "You pay the shipping 200 kr first and I send the bike.",
    "Send 500 kr first, then I post it.",
    "Betal 500 kr først, så sender jeg den."
  ];
  for (const text of risky) await assertRisk(seller(text), text, "pay_before_see");
  const quiet = [
    "Send me two more photos first, then I'll decide.",
    "I'll transfer the 500 kr first thing on Monday when I pick it up.",
    "Never send 500 kr first to someone you haven't met.",
    "Pay 500 kr when you pick it up, but have a look at it first."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
});

// 10. PayPal F&F under other names.
test("PayPal FF, PayPal friends, mark as gift and personal-not-business warn", async () => {
  const risky = [
    "Pay 900 kr PayPal FF",
    "Can you pay with PayPal friends? 900 kr",
    "Mark it as a gift on PayPal so there's no fee, 900 kr.",
    "Just send it as personal, not as business, 900 kr on PayPal."
  ];
  for (const text of risky) await assertRisk(seller(text), text, "friends_family");
  const quiet = [
    "My PayPal friends list is a mess, haha. 900 kr at pickup.",
    "I bought it as a gift for my son, 900 kr.",
    "It was for personal use only, never used for business. 900 kr.",
    "Sure, I'll mark it as a gift and wrap it, 900 kr at pickup."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
});
