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

// 11. Danish "betale forud" is "pay in advance".
test("Danish betal forud warns", async () => {
  await assertRisk(seller("Du skal betale 1500 kr forud, så sender jeg cyklen med PostNord."), "betale forud", "upfront_deposit");
  await assertRisk(seller("Overfør 1500 kr forud til min konto."), "overfør forud", "upfront_deposit");
  await assertSilent(seller("Du skal ikke betale noget forud, betal ved afhentning."), "ikke forud");
  await assertSilent(seller("Ring gerne forud, så er jeg hjemme. 1500 kr ved afhentning."), "ring forud");
});

// 12. Seller-side scam: "I paid you, now pay the courier fee".
test("a courier or insurance fee after a fake payment warns", async () => {
  await assertRisk(seller("I have paid you via PayPal, check your email for the confirmation and send the 300 kr courier fee."), "paid you + fee", "fee_via_link");
  // Caught as an amount paid first (fix 9); "my courier" alone is not fee context.
  await assertRisk(seller("Send me your email so I can pay with PayPal, my courier will pick it up. Please pay the 200 kr insurance fee first."), "insurance fee first");
  await assertSilent(seller("The courier fee is 60 kr, it's included in the checkout price."), "courier fee in checkout");
  await assertSilent(seller("The courier fee is 60 kr, you can also pick it up for free."), "courier fee price");
  await assertSilent(seller("I've already paid the shipping fee, you pay 900 kr at pickup."), "seller paid shipping");
});

// 13. "Send 500 kr as a guarantee" is a deposit by another name.
test("money as a guarantee or security warns", async () => {
  await assertRisk(seller("Send 500 kr as a guarantee and I keep it for you."), "as guarantee", "upfront_deposit");
  await assertRisk(seller("I need 500 kr first as a guarantee that you'll come."), "need as guarantee", "upfront_deposit");
  await assertSilent(seller("The bike comes with the receipt as a guarantee it's not stolen."), "receipt");
});

// The background cache keys verdicts by RULES_VERSION for 24 hours, so a build
// with changed verdicts needs a new version or testers keep the old cards.
test("rules version is bumped past v4 for the pre-freeze fixes", async () => {
  const verdict = await seller("I won't ask for a deposit, pay when you pick it up.");
  assert.ok(verdict.rulesVersion >= 5, JSON.stringify(verdict));
});

// 14. "MobilePay or cash" is an in-person payment: cash cannot be sent ahead.
test("a rail offered next to cash stays quiet", async () => {
  const quiet = [
    "Vil du betale med MobilePay eller kontant? Pris 450 kr.",
    "Pay 450 kr by MobilePay or cash, whatever suits you.",
    "Kontant eller MobilePay, 450 kr."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
  const risky = [
    "Send a 200 kr deposit on MobilePay or cash, today, so I hold it.",
    "Send 450 kr on MobilePay now, or cash if you come today. I ship tomorrow otherwise."
  ];
  for (const text of risky) await assertRisk(seller(text), text);
});

// 15. "I paid by bank transfer when I bought it" is purchase history.
test("a past purchase paid by bank transfer stays quiet", async () => {
  await assertSilent(seller("I paid by bank transfer when I bought it, here is the receipt photo."), "history");
  await assertSilent(seller("We paid 900 kr via Revolut for it last year, now 450 kr."), "history revolut");
  await assertRisk(seller("Pay 450 kr by bank transfer today, I bought a new one so I ship tomorrow."), "ask + bought", "off_platform");
});

// 16. Independent review of fixes 1–15: inputs that main got right and an
// earlier version of this branch got wrong. Each must match main again.
test("review: ordinary chats the earlier fixes flagged stay quiet", async () => {
  const quiet = [
    "It comes with 2 years as a guarantee from Elgiganten, 1200 kr cash on pickup.",
    "The receipt works as a guarantee, it's 2 months old. 800 kr, pay at pickup.",
    "Works as a security camera too, 450 kr, pick up in Valby.",
    "I'm employed as security at the airport so I can only meet after 18. Price 300 kr.",
    "Leave your passport as collateral while you test drive it, price 5000 euro cash.",
    "Shipping with DAO, courier fee is 65 kr, so 465 kr total. Check your email for the tracking.",
    "I'll send it by courier, courier fee is 60 kr. Check your inbox, I sent the invoice.",
    "My courier will pick it up Friday. Courier fee 70 kr is on me, pay me 500 kr in cash.",
    "Du kan hente den nu og betale med Vipps ved afhentning, 250 kr.",
    "Prisen er 400 kr nu og du betaler med Venmo ved afhentning.",
    "Kom først og se den og betal med Vipps når du henter den, 300 kr.",
    "Du betaler når du henter den, ingen grund til at betale noget forud.",
    "Vil du betale forud eller ved afhentning? Begge dele går.",
    "Lots of people here only use friends and family which is risky. Cash at pickup for me, 200 kr.",
    "We only use friends and family for the kids' clothes swap group, but for you it's cash on pickup.",
    "Honestly I only do friends and family deals on this stuff, otherwise it's full price 300.",
    "Is it a present? I can wrap it and mark it as a gift for 20 kr extra, you pay with PayPal or cash.",
    "It was marked as gift in the PayPal order from the shop, so the price isn't shown. Send 250 kr cash on pickup."
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
});

test("review: scams the earlier fixes silenced warn again", async () => {
  const risky = [
    "Please MobilePay 400 kr to 22334455 to secure it, then pick it up on Saturday when we meet.",
    "Betal 200 kr med MobilePay inden fredag, så holder jeg den. Resten på stedet.",
    "Bank transfer of 2000 kr tonight please and you can collect it when we meet tomorrow.",
    "Pay via Revolut, 80 euro, I'll keep it aside for you and you pick it up on the spot Saturday.",
    "Overfør 400 kr via bankoverførsel, så afleverer jeg den på stedet.",
    "Send me 200 kr on MobilePay and I'll hold it for you, rest when you pick it up.",
    "Payment first? No exceptions, 400 kr to my account and I post it.",
    "Pay first? No refunds after that, send 300 eur and I ship Monday.",
    "Payment first? Nope, that's just how I do it, transfer 500 kr and I post it.",
    "I don't need a deposit, but send 300 kr today to hold it.",
    "I'll hold it for you without deposit if you send 300 kr today.",
    "Bankoverførsel 3000 kr i dag, så kan du hente den ved afhentning i weekenden.",
    "Send a 100 kr deposit for the crates and I'll put them aside for you."
  ];
  for (const text of risky) await assertRisk(seller(text), text);
  const high = await seller("Send me 200 kr on MobilePay and I'll hold it for you, rest when you pick it up.");
  assert.equal(high.level, "high", JSON.stringify(high));
  const full = await seller("I don't charge a deposit, just pay the 1500 kr in full now via Revolut and it's yours.");
  assert.equal(full.level, "high", JSON.stringify(full));
});

test("review: hold rules stay fast on a long repetitive chat", async () => {
  const text = "hold it for you when you pick it up ".repeat(560); // about 20 KB
  const t0 = performance.now();
  await seller(text);
  assert.ok(performance.now() - t0 < 2000, "took " + Math.round(performance.now() - t0) + " ms");
});

// 17. Second independent review: more cases main got right.
test("review 2: 'or cash' does not quiet a rail when the seller ships or refuses cash", async () => {
  const risky = [
    "MobilePay or cash, I ship after payment, 400 kr + fragt",
    "Zelle or cash app only, $400, I'll ship it UPS once received",
    "Venmo or cash, but I'm out of town so Venmo $250 and I'll mail it",
    "Send the money by Western Union or cash in an envelope by post",
    "Revolut me 200 EUR, I'll post it, or cash if you come to Aarhus",
    "Send 400 kr on MobilePay right away, cash or card not possible",
    "Swish eller kontant går bra, men jag skickar först när pengarna kommit, 600 kr",
    "Kontant eller MobilePay går ikke, kun bankoverførsel forud: 2000 kr",
    "Zelle or cash, I can also ship if you Zelle first $500"
  ];
  for (const text of risky) await assertRisk(seller(text), text);
});

test("review 2: 'I have paid you' plus an ordinary fee mention stays quiet", async () => {
  const quiet = [
    "Thanks, I have paid you 450 kr incl. the delivery fee",
    "I've paid you now, 300 kr + 50 kr shipping fee, please send tracking",
    "We've paid you 1200 kr. Shipping fee is on us, we'll arrange the courier",
    "I've already paid you, did the shipping cost come through too?"
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
  await assertRisk(seller("I have already paid you, check your email. Now please pay the courier fee of 50 euro to my agent."), "pay the courier fee", "fee_via_link");
});

test("review 2: 'Pay first? No, ...' followed by a real ask still warns", async () => {
  const risky = [
    "Pay first? No, I'm not a scammer, transfer the money and I'll ship",
    "Pay first? No, I don't do pickups, send the money and I'll post it",
    "Payment first? No, it's not a scam, Vipps me and I'll ship",
    "Payment first? No, half now via MobilePay and half when it arrives",
    "Pay first? No, send half now and half when it arrives",
    "Payment first? Nope, only the shipping cost first, then the rest"
  ];
  for (const text of risky) await assertRisk(seller(text), text);
  await assertSilent(seller("Pay first? No, come and look first."), "come and look first");
});

test("review 2: purchase history followed by an ask still warns", async () => {
  await assertRisk(seller("We paid with Wise when we bought it, pay with Wise too: 300 EUR now"), "wise history + ask", "off_platform");
  await assertRisk(seller("We paid with bank transfer last week, so you must pay the same way: transfer 1500 kr now"), "transfer history + ask", "off_platform");
});

// 18. Third independent review. The older rail gates now use the v4 helpers
// unchanged; only the 5 Nov gates use the extended v5 handover helpers.
test("review 3: scams main catches still warn", async () => {
  const risky = [
    "Venmo me $50 and I'll hold it for you, then pay the balance when you pick it up.",
    "Send 200 kr and I'll hold it for you, the other 700 kr when you pick it up.",
    "I'll hold it for you, Zelle me $50 so I know you're serious, pay at pickup",
    "I'll hold it for you, just send 200 kr as a reservation and pay when you pick it up.",
    "I'll hold the bike for you, Zelle $50 and you pay $400 when you pick it up.",
    "Jeg holder den til dig hvis du sender 200 kr, og 700 kr når du henter den.",
    "Zelle me $500 and I'll bring it over, you can check it on the spot.",
    "Venmo me $80 to lock it in, the rest on the spot.",
    "Pay the delivery guy on the spot, but Venmo me $80 for the item first.",
    "Betal 500 kr med Vipps og så holder jeg den, du henter den når vi mødes",
    "I don't need a deposit. Send the full 1500 kr and I ship.",
    "I don't want a deposit, I want the whole 2000 kr up front.",
    "I don't need a deposit, just send the money and I ship it.",
    "I won't ask for a deposit; transfer the full 900 kr and I ship.",
    "Kontant eller MobilePay, men overfør 100 kr i forvejen for at holde den.",
    "I don't need a deposit, the full 900 kr before shipping is enough.",
    "I won't ask for a deposit, I want full payment before shipping, 900 kr.",
    "Hold it for you till friday, send 25 dollars to confirm, pay at pickup",
    "I'll hold it for you for a 100 kr fee, pay 800 kr when you pick it up",
    "Betal først? Nej tak til byttehandler, 500 kr på konto og jeg sender."
  ];
  for (const text of risky) await assertRisk(seller(text), text);
});

test("review 3: ordinary chats stay quiet", async () => {
  const quiet = [
    "You can pay with Venmo tonight when you pick it up, $200.",
    "Pay with Zelle tonight when we meet, $300.",
    "Du kan betale med Vipps i aften når du henter den, 300 kr.",
    "Du kan betale med Vipps nu når du henter den, 300 kr.",
    "Betal med Swish i dag vid upphämtning, 400 kr.",
    "Betal med Vipps inden du går, når du henter den. 200 kr.",
    "Price-wise I can't go lower today, pay with Zelle when you pick it up, $300",
    "It's wise to come today and pay with Venmo when you pick it up, $80.",
    "Du betaler selvfølgelig ikke forud, 450 kr når du henter.",
    "Du betaler intet forud, 450 kr ved afhentning.",
    "Betale forud? Nej tak, 450 kr ved afhentning.",
    "Should I send 500 kr first? No, just pay when you pick it up.",
    "Pay 500 kr first? No way, pay when you pick it up.",
    "You can pay 900 kr after testing it first.",
    "You don't need to send anything as a guarantee, pay 500 kr when you pick it up.",
    "I'd never ask you to send money as a guarantee, 500 kr at pickup",
    "PayPal FF? No, cash only. 900 kr",
    "I have paid you, now please send me the tracking. Shipping fee was 50 kr.",
    "I've paid you now. Please send the shipping fee receipt.",
    "Do you want me to transfer 500 kr first? Not needed, pay at pickup.",
    "Betale forud? Det gør jeg ikke, du betaler ved afhentning.",
    "Should I send 200 kr as a guarantee? Not needed, pay when you pick it up.",
    "I only use PayPal FF with my family, you pay cash, 300 kr"
  ];
  for (const text of quiet) await assertSilent(seller(text), text);
});

// 19. Final independent review.
test("review 4: a seller who accepts the buyer's checkout or G&S request hides the card", async () => {
  const accepted = [
    [{ from: "seller", text: "Venmo $300 and I'll ship it." }, { from: "buyer", text: "Could we go through the marketplace checkout instead?" }, { from: "seller", text: "Sure thing." }],
    [{ from: "seller", text: "Pay first and I ship, 600 kr." }, { from: "buyer", text: "Can we use the platform checkout?" }, { from: "seller", text: "Ja, brug checkout." }],
    [{ from: "seller", text: "Deposit of 300 kr by MobilePay to hold it." }, { from: "buyer", text: "I'd rather pay through the marketplace checkout." }, { from: "seller", text: "Okay, that works." }],
    [{ from: "seller", text: "PayPal F&F $90 shipped." }, { from: "buyer", text: "G&S?" }, { from: "seller", text: "Happy to do G&S, it adds about $3 in fees, so $93." }]
  ];
  for (const messages of accepted) await assertSilent(thread(messages), JSON.stringify(messages));
  // Not accepted: the seller insists.
  await assertRisk(thread([
    { from: "buyer", text: "Can I pay through the marketplace checkout?" },
    { from: "seller", text: "Ok but send 500 kr deposit via Friends & Family first." }
  ]), "ok but insists", "friends_family");
});

test("review 4: scams main catches still warn", async () => {
  const risky = [
    "MobilePay eller kontant. Jeg er ikke hjemme, så overfør 800 kr og hent den hos naboen.",
    "Bank transfer or cash, I'm not home so transfer 3000 kr and grab it from the porch.",
    "Revolut eller kontant, overfør 200 euro og min bror giver dig den.",
    "Payment first? No other choice, I travel a lot.",
    "Pay first? No meetups, it's company policy.",
    "Payment first? No viewing possible, the car is at my brother's place.",
    "Betal først? Nej, det er sådan jeg gør det. Jeg er i Jylland.",
    "Pay first? Nope. Only shipping, I live 300 km away.",
    "We don't require a deposit, but please pay in full before I post it.",
    "I don't need a deposit, just pay in full and I'll post it tomorrow.",
    "MobilePay 600 kr når du henter, men send dem gerne inden.",
    "Pay by Revolut when we meet, I need the 300 euro this morning though."
  ];
  for (const text of risky) await assertRisk(seller(text), text);
});
