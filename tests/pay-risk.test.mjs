import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

const FF = "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow";
const SAFE_FRIENDS = "My friends and family loved this lamp, but I am moving house soon";

function countingAsk(impl) {
  const state = { calls: 0 };
  const askLlm = async (payload) => {
    state.calls += 1;
    return impl(payload);
  };
  return { askLlm, state };
}

test("short text is silent and does not ask the model", async () => {
  const { askLlm, state } = countingAsk(async () => ({ risky: true, evidence: ["x"] }));
  const verdict = await detect("pay F&F now", {}, { askLlm });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "short");
  assert.equal(state.calls, 0);
});

test("no atom is silent and does not ask the model", async () => {
  const { askLlm, state } = countingAsk(async () => ({ risky: true, evidence: ["bike"] }));
  const verdict = await detect("Yes the bike is still available and the tyres are new.", {}, { askLlm });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "no_atom");
  assert.equal(state.calls, 0);
});

test("weak atoms alone are silent and do not ask the model", async () => {
  const { askLlm, state } = countingAsk(async () => ({ risky: true, evidence: ["today only"] }));
  const verdict = await detect("Several people are asking and it is today only, come and see it.", {}, { askLlm });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "weak_only");
  assert.equal(state.calls, 0);
});

test("a veto is silent and does not ask the model", async () => {
  const { askLlm, state } = countingAsk(async () => ({ risky: true, evidence: ["Friends"] }));
  const text = "Send 500 kr via Friends & Family, or cash on pickup if you prefer to wait.";
  const verdict = await detect(text, {}, { askLlm });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "veto");
  assert.equal(state.calls, 0);
});

test("friends and family without a pay word stays silent", async () => {
  const { askLlm, state } = countingAsk(async () => ({ risky: true, evidence: ["friends"] }));
  const verdict = await detect(SAFE_FRIENDS, {}, { askLlm });
  assert.equal(verdict.kind, "silent");
  assert.equal(state.calls, 0);
});

test("two strong atoms are high risk", async () => {
  const verdict = await detect(FF, { listingTitle: "Used road bike", listingPrice: "1,800 kr" });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.ok(verdict.signals.includes("friends_family"));
  assert.ok(verdict.signals.includes("upfront_deposit"));
  assert.equal(verdict.llm, "off");
  assert.equal(verdict.deal.item, "Used road bike");
  assert.equal(verdict.deal.amount, 1800);
  assert.equal(verdict.deal.depositAmount, 500);
  assert.ok(verdict.reason.length <= 120);
  assert.equal(verdict.reason.includes("\n"), false);
  for (const span of verdict.evidence) assert.equal(FF.slice(span.start, span.end), span.text);
});

test("one strong atom plus a weak atom is high", async () => {
  const text = "Please pay by bank transfer. Several people are asking so today only.";
  const verdict = await detect(text);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.ok(verdict.signals.includes("off_platform"));
  assert.ok(verdict.signals.includes("urgency_pressure"));
});

test("one strong atom with an amount is medium", async () => {
  const text = "Buy a €100 gift card and send me the code on email please.";
  const verdict = await detect(text);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["off_platform"]);
});

test("rules result stands when no askLlm is passed", async () => {
  const verdict = await detect(FF);
  assert.equal(verdict.llm, "off");
  assert.equal(verdict.level, "high");
});

test("risky false from the model silences the card", async () => {
  const { askLlm, state } = countingAsk(async () => ({
    risky: false,
    level: "none",
    reason: "Ordinary chat",
    evidence: ["Friends & Family"]
  }));
  const verdict = await detect(FF, {}, { askLlm });
  assert.equal(state.calls, 1);
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "llm_disagrees");
});

test("fabricated evidence silences the card", async () => {
  const verdict = await detect(FF, {}, {
    askLlm: async () => ({
      risky: true,
      level: "high",
      reason: "Looks risky",
      evidence: ["this quote was not in the chat"]
    })
  });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "llm_disagrees");
});

test("whitespace-normalized evidence can confirm", async () => {
  const text = "Send 500 kr deposit via PayPal Friends   &  Family to hold it, I ship tomorrow";
  const verdict = await detect(text, {}, {
    askLlm: async () => ({
      risky: true,
      level: "high",
      reason: "Friends & Family plus a deposit is hard to recover.",
      evidence: ["Friends & Family"]
    })
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.llm, "confirmed");
  assert.equal(verdict.level, "high");
});

test("the model cannot raise medium to high", async () => {
  const text = "Buy a €100 gift card and send me the code on email please.";
  const verdict = await detect(text, {}, {
    askLlm: async () => ({
      risky: true,
      level: "high",
      reason: "Gift card payment before you have the item.",
      evidence: ["gift card"]
    })
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
});

test("the model can lower high to medium", async () => {
  const verdict = await detect(FF, {}, {
    askLlm: async () => ({
      risky: true,
      level: "medium",
      reason: "Deposit via Friends & Family is hard to recover.",
      evidence: ["Friends & Family"]
    })
  });
  assert.equal(verdict.level, "medium");
  assert.equal(verdict.llm, "confirmed");
});

test("model error caps a high result at medium", async () => {
  const verdict = await detect(FF, {}, {
    askLlm: async () => {
      throw new Error("boom");
    }
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.equal(verdict.llm, "error");
});

test("model timeout caps a high result at medium", async () => {
  const verdict = await detect(FF, {}, {
    askLlm: () => new Promise(() => {}),
    timeoutMs: 30
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.equal(verdict.llm, "error");
});

test("llm_off from the backend keeps the rules level", async () => {
  const verdict = await detect(FF, {}, {
    askLlm: async () => {
      const error = new Error("llm_off");
      error.code = "llm_off";
      error.status = 503;
      throw error;
    }
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.equal(verdict.llm, "off");
});

test("banned promise language in a model reason is dropped", async () => {
  const verdict = await detect(FF, {}, {
    askLlm: async () => ({
      risky: true,
      level: "high",
      reason: "You are protected if you pay this way now",
      evidence: ["Friends & Family"]
    })
  });
  assert.equal(verdict.kind, "risk");
  assert.match(verdict.reason, /may have no way/i);
  assert.equal(/you are protected/i.test(verdict.reason), false);
});

test("reversed friends and family, slash, and spaced F & F", async () => {
  const high = [
    "Please send 500 kr via PayPal family and friends, I ship tomorrow.",
    "Send 500 kr via PayPal til familie og venner, jeg kan kun sende varen.",
    "Send 500 kr PayPal friends/family, I ship tomorrow.",
    "Send 500 kr via F & F now, I ship tomorrow."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["friends_family", "ship_before_meet"], text);
  }

  const medium = [
    "Please send 500 kr via PayPal family and friends today.",
    "Send 500 kr via PayPal til familie og venner i dag.",
    "Please send 500 kr via PayPal friends/family today.",
    "Please send 500 kr via F & F today."
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["friends_family"], text);
  }
});

test("exact friends and family, F&F, and FnF stay high", async () => {
  const exact = [
    "Please send 500 kr via PayPal Friends and Family now, I ship tomorrow.",
    "Please send 500 kr via F&F now, I ship tomorrow.",
    "Please send 500 kr via FnF now, I ship tomorrow."
  ];
  for (const text of exact) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["friends_family", "ship_before_meet"], text);
  }
});

test("household friends and family stays silent", async () => {
  const quiet = [
    "My friends and family loved this lamp.",
    "My family and friends loved this lamp.",
    "Mine venner og familie kommer på besøg i morgen.",
    "Min familie og venner kigger forbi i morgen."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

test("personal PayPal payment is friends and family", async () => {
  const medium = await detect("Please send a personal PayPal payment of 500 kr today.");
  assert.equal(medium.kind, "risk");
  assert.equal(medium.level, "medium");
  assert.deepEqual(medium.signals, ["friends_family"]);

  const high = await detect("Please send a personal PayPal payment of 500 kr, I ship tomorrow.");
  assert.equal(high.kind, "risk");
  assert.equal(high.level, "high");
  assert.deepEqual(high.signals, ["friends_family", "ship_before_meet"]);

  const exact = await detect("Please send a personal payment of 500 kr, I ship tomorrow.");
  assert.equal(exact.kind, "risk");
  assert.equal(exact.level, "high");
  assert.deepEqual(exact.signals, ["friends_family", "ship_before_meet"]);
});

test("personal PayPal without the word payment stays silent", async () => {
  const story = await detect("This is my personal PayPal. I bought tickets yesterday.");
  assert.equal(story.kind, "silent");
  assert.equal(story.silentReason, "no_atom");
  assert.deepEqual(story.signals, []);

  const card = await detect("Send a gift card for 500 kr via email today please.");
  assert.equal(card.kind, "risk");
  assert.equal(card.level, "medium");
  assert.deepEqual(card.signals, ["off_platform"]);
});

test("through Wise, på Wise, and Wise transfer are off-platform", async () => {
  assert.equal(atoms.hasPayWord("Please make a Wise transfer of 500 kr today"), false);

  const high = [
    "Please send 500 kr through Wise today, I ship tomorrow.",
    "Send 500 kr på Wise i dag, jeg kan kun sende varen.",
    "Please make a Wise transfer of 500 kr today, I ship tomorrow."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"], text);
  }

  const medium = [
    "Please send 500 kr through Wise today.",
    "Send 500 kr på Wise i dag.",
    "Please make a Wise transfer of 500 kr today."
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
  }

  const via = await detect("Please send 500 kr via Wise today, I ship tomorrow.");
  assert.equal(via.kind, "risk");
  assert.equal(via.level, "high");
  assert.deepEqual(via.signals, ["off_platform", "ship_before_meet"]);
});

test("a town called Wise and the adjective stay silent", async () => {
  const quiet = [
    "Wise is a town I visited last summer with my sister.",
    "Be wise and pick the bike up on Thursday afternoon."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

test("otherwise transfer and likewise transfer are not Wise", async () => {
  const quiet = [
    "Please send 500 kr or otherwise transfer the bike next week.",
    "Please likewise transfer 500 kr for the spare keys today.",
    "You can pay cash or otherwise transfer at pickup.",
    "Please pay 500 kr upon wise advice from the seller today.",
    "Please send 500 kr through wiser choices next week."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
  }
});

test("an amount next to Telegram or WhatsApp is off-platform", async () => {
  const medium = await detect("Send 500 kr via Telegram today please.");
  assert.equal(medium.kind, "risk");
  assert.equal(medium.level, "medium");
  assert.deepEqual(medium.signals, ["off_platform"]);

  const high = [
    "Send 500 kr via Telegram today, I ship tomorrow.",
    "Send 500 kr via WhatsApp today, I ship tomorrow.",
    "Betal 500 kr via Telegram i dag, jeg kan kun sende varen."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"], text);
  }

  const payMe = await detect("Pay me on Telegram, 500 kr, I ship tomorrow.");
  assert.equal(payMe.kind, "risk");
  assert.equal(payMe.level, "high");
  assert.deepEqual(payMe.signals, ["off_platform", "ship_before_meet"]);
});

test("chat without an amount stays off the rail", async () => {
  const chat = await detect("We can chat on Telegram about the bike on Thursday.");
  assert.equal(chat.kind, "silent");
  assert.equal(chat.silentReason, "no_atom");
  assert.deepEqual(chat.signals, []);

  const photo = await detect("Send a photo on Telegram of the bike. You can pick it up Thursday.");
  assert.equal(photo.kind, "silent");
  assert.equal(photo.silentReason, "no_atom");
  assert.deepEqual(photo.signals, []);

  const photoShip = await detect("Send a photo on Telegram of the bike, I ship tomorrow.");
  assert.equal(photoShip.kind, "silent");
  assert.equal(photoShip.silentReason, "weak_only");
  assert.deepEqual(photoShip.signals, ["ship_before_meet"]);

  const address = await detect("Send the address via WhatsApp when you pick it up.");
  assert.equal(address.kind, "silent");
  assert.equal(address.silentReason, "veto");
});

test("a price beside WhatsApp or Telegram is not a pay ask", async () => {
  const listings = [
    "Message me on WhatsApp, 500 kr, pickup only",
    "Contact me on WhatsApp, price 500 kr, pickup Thursday",
    "Pay upon Telegram, 500 kr today please.",
    "See the listing anon WhatsApp, price 500 kr today."
  ];
  for (const text of listings) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
  }
});

test("upfront, in advance, holding fee, and reserve the bike", async () => {
  const pairs = [
    ["Please pay 500 kr upfront via PayPal today.", "Please pay 500 kr upfront via PayPal today. I ship tomorrow."],
    ["Please pay 500 kr in advance via PayPal today.", "Please pay 500 kr in advance via PayPal today. I ship tomorrow."],
    ["Please pay a holding fee of 500 kr via PayPal today.", "Please pay a holding fee of 500 kr via PayPal today. I ship tomorrow."],
    ["Send 500 kr to reserve the bike via PayPal today.", "Send 500 kr to reserve the bike via PayPal today. I ship tomorrow."]
  ];
  for (const [mediumText, highText] of pairs) {
    const medium = await detect(mediumText);
    assert.equal(medium.kind, "risk", mediumText);
    assert.equal(medium.level, "medium", mediumText);
    assert.deepEqual(medium.signals, ["upfront_deposit"], mediumText);

    const high = await detect(highText);
    assert.equal(high.kind, "risk", highText);
    assert.equal(high.level, "high", highText);
    assert.deepEqual(high.signals, ["upfront_deposit", "ship_before_meet"], highText);
  }
});

test("half now and Danish reservere stay high", async () => {
  const stay = [
    "Pay half now, 500 kr via PayPal, I ship tomorrow.",
    "Send 500 kr for at reservere cyklen via PayPal, jeg kan kun sende varen."
  ];
  for (const text of stay) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.ok(verdict.signals.includes("upfront_deposit"), text);
    assert.ok(verdict.signals.includes("ship_before_meet"), text);
  }
});

test("bare upfront and everyday reserve wording stay silent", async () => {
  const quiet = [
    "The upfront cost of new tyres was 500 kr last year.",
    "I will write in advance of our meeting on Thursday.",
    "I reserve the right to cancel the viewing on Thursday.",
    "We walked through the nature reserve and saw a deer.",
    "Please reserve a table for four at the cafe tonight.",
    "I am holding the bike in the garage until Thursday.",
    "The museum has a holding fee for coats, not for this bike."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }

  const pickup = await detect("You can pay cash when you pick it up. No deposit needed before we meet.");
  assert.equal(pickup.kind, "silent");
  assert.equal(pickup.silentReason, "veto");
});

test("negation after upfront wording and cross-sentence joins stay silent", async () => {
  const quiet = [
    "Payment upfront is not required",
    "No deposit in advance needed",
    "No need to pay in advance for the bike today.",
    "You do not have to pay upfront for the bike today.",
    "Pickup in Aarhus. Pay upfront elsewhere is a scam.",
    "I'll pay for fuel. Upfront I should say the tank was full.",
    "Payment in advance isn't needed before we meet on Thursday.",
    "The holding fee of 500 kr is not required before we meet.",
    "Send 500 kr to reserve the bike is not required today.",
    "I don't need payment upfront."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }

  const nothing = await detect("You can pay at pickup, nothing upfront is due before Thursday.");
  assert.equal(nothing.kind, "silent");
  assert.equal(nothing.signals.includes("upfront_deposit"), false);
});

test("an upfront ask still flags when the next sentence mentions a scam", async () => {
  const verdict = await detect("Please pay 500 kr upfront. The other offer is a scam.");
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["upfront_deposit"]);
});

test("dotted amounts, pay punctuation, up front, and reserve it flag", async () => {
  const phrases = [
    "Please pay 1.500 kr upfront",
    "Pay $12.50 upfront",
    "Pay e.g. 500 kr upfront",
    "Payment: 500 kr upfront via PayPal",
    "Upfront payment of 500 kr via PayPal",
    "Pay 500 kr up front",
    "Send 500 kr to reserve it"
  ];
  for (const phrase of phrases) {
    assert.ok(atoms.findAtoms(phrase).some((hit) => hit.atom === "upfront_deposit"), phrase);
    const message = phrase.length >= 20 ? phrase : `${phrase} today.`;
    const verdict = await detect(message);
    assert.equal(verdict.kind, "risk", message);
    assert.equal(verdict.level, "medium", message);
    assert.deepEqual(verdict.signals, ["upfront_deposit"], message);
  }
});

test("a later clause does not negate the upfront ask", async () => {
  const medium = [
    "Pay upfront, viewing isn't needed",
    "Pay me 500 kr, no meetup, upfront via PayPal",
    "Pay 500 kr upfront, the other buyer's offer is a scam"
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["upfront_deposit"], text);
  }

  const high = await detect("Pay 500 kr upfront, meeting is not necessary, I ship tomorrow");
  assert.equal(high.kind, "risk");
  assert.equal(high.level, "high");
  assert.deepEqual(high.signals, ["upfront_deposit", "ship_before_meet"]);
});

test("negating the payment itself stays silent", async () => {
  const quiet = ["no upfront payment", "you don't pay upfront"];
  for (const phrase of quiet) {
    assert.equal(atoms.findAtoms(phrase).some((hit) => hit.atom === "upfront_deposit"), false, phrase);
    const message = phrase.length >= 20 ? phrase : `There is ${phrase} for the bike.`;
    const verdict = await detect(message);
    assert.equal(verdict.kind, "silent", message);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, message);
  }
});

test("upfront as a figure of speech or a place on the bike stays silent", async () => {
  const quiet = [
    "To be upfront with you, I can only pay 400 kr.",
    "The light up front is new, you can pay by cash Thursday."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }
});

test("modal negation and a question answered no stay silent", async () => {
  const quiet = [
    "You shouldn't pay upfront for a used bike.",
    "You won't have to pay upfront, we meet Thursday.",
    "Pay in advance? No, cash when we meet is fine."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }
});

test("send, transfer, and paid still count as an upfront ask", async () => {
  const high = [
    "Send 500 kr upfront via PayPal, I ship tomorrow",
    "500 kr paid upfront, I ship tomorrow"
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["upfront_deposit", "ship_before_meet"], text);
  }

  const medium = [
    "Transfer 500 kr in advance",
    "Send $50 upfront today please.",
    "Please send the money in advance today.",
    "Send the deposit upfront today please.",
    "Please transfer the money in advance today.",
    "Transfer the deposit upfront today please.",
    "Pay in advance? No problem, send 500 kr now."
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["upfront_deposit"], text);
  }
});

test("send and transfer without money stay silent", async () => {
  const quiet = [
    "Can you send the address in advance?",
    "Send me your number in advance and I will call.",
    "I will send you the pickup address in advance.",
    "I will send you the exact location in advance.",
    "Can I send you a message in advance before I come?",
    "Please send your questions upfront, I reply fast."
  ];
  for (const text of quiet) {
    assert.equal(atoms.findAtoms(text).some((hit) => hit.atom === "upfront_deposit"), false, text);
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }
});

test("a count of things sent upfront stays silent", async () => {
  const quiet = [
    "Send me 2 photos in advance please.",
    "Send me 3 pictures upfront.",
    "Can you send 10 more photos in advance?",
    "I will send you the 2 keys in advance.",
    "Send me 4 more pics upfront, thanks."
  ];
  for (const text of quiet) {
    assert.equal(atoms.findAtoms(text).some((hit) => hit.atom === "upfront_deposit"), false, text);
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }
});

test("payment that names a thing stays silent", async () => {
  const quiet = [
    "Send me your payment details in advance.",
    "Send me the payment link in advance."
  ];
  for (const text of quiet) {
    assert.equal(atoms.findAtoms(text).some((hit) => hit.atom === "upfront_deposit"), false, text);
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }
});

test("payment, a share, or a bare number in the gap still flags", async () => {
  const medium = [
    "Please send payment upfront.",
    "Send payment upfront and I hold it.",
    "Send your payment in advance.",
    "Send the payment in advance and I will ship.",
    "Send me 50% upfront and the rest on delivery.",
    "Please transfer the full amount upfront.",
    "Transfer the amount in advance to my account.",
    "Send 500 upfront.",
    "Send half upfront today please.",
    "send payment upfront",
    "send the payment in advance"
  ];
  for (const text of medium) {
    assert.ok(atoms.findAtoms(text).some((hit) => hit.atom === "upfront_deposit"), text);
    const message = text.length >= 20 ? text : `${text} today.`;
    const verdict = await detect(message);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["upfront_deposit"], text);
  }
});

test("paid history stays silent", async () => {
  const quiet = [
    "I paid 3000 kr for it upfront at the shop two years ago.",
    "I paid 500 kr upfront last month at the shop.",
    "I paid for it upfront when I bought it new.",
    "I paid 3000 kr for it upfront at the shop in 2022.",
    "I paid for the service upfront."
  ];
  for (const text of quiet) {
    assert.equal(atoms.findAtoms(text).some((hit) => hit.atom === "upfront_deposit"), false, text);
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(verdict.signals.includes("upfront_deposit"), false, text);
  }
});
test("named payment rails with an amount are off-platform", async () => {
  const high = [
    "Please send 500 kr via Western Union today, I ship tomorrow.",
    "Please send 500 kr via MoneyGram today, I ship tomorrow.",
    "Please send 500 kr via Venmo today, I ship tomorrow.",
    "Please send 500 kr via Zelle today, I ship tomorrow.",
    "Please send 500 kr via Cash App today, I ship tomorrow.",
    "Please send 500 kr via Swish today, I ship tomorrow.",
    "Send 500 kr via Vipps i dag, jeg kan kun sende varen."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"], text);
  }

  const swish = await detect("Please send 500 kr via Swish today.");
  assert.equal(swish.kind, "risk");
  assert.equal(swish.level, "medium");
  assert.deepEqual(swish.signals, ["off_platform"]);

  const mobile = await detect("Send 500 kr via MobilePay nu, jeg kan kun sende varen.");
  assert.equal(mobile.kind, "risk");
  assert.equal(mobile.level, "high");
  assert.deepEqual(mobile.signals, ["off_platform", "ship_before_meet"]);
});

test("bare rail names and a gift card stay in their lanes", async () => {
  const quiet = [
    "I heard a swish when the bike chain moved on Thursday.",
    "The cash app on my phone crashed before the meeting.",
    "Venmo is not how we should meet to see the bike.",
    "Western Union is a street I walked down last Thursday."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }

  const card = await detect("Send a gift card for 500 kr via email today please.");
  assert.equal(card.kind, "risk");
  assert.equal(card.level, "medium");
  assert.deepEqual(card.signals, ["off_platform"]);
});

test("bike brands, pickup Swish, and a refused rail stay quiet", async () => {
  const quiet = [
    "Gazelle city bike, 500 kr",
    "I was swishing the chain on this 500 kr bike yesterday.",
    "I accept Swish or cash at pickup",
    "Swish on pickup is fine, the bike is 500 kr.",
    "I accept Vipps or cash when you pick it up on Saturday.",
    "I don't take Venmo, 500 kr cash at pickup",
    "I don't take Venmo, the bike is 500 kr and we meet Thursday.",
    "I never use Zelle. The price is 500 kr for the bike."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
  }
});

test("paying by Swish before the seller ships is off-platform", async () => {
  const swish = await detect("Send 500 kr by Swish first, then I ship");
  assert.equal(swish.kind, "risk");
  assert.equal(swish.level, "medium");
  assert.deepEqual(swish.signals, ["off_platform"]);

  const vipps = await detect("Vipps 500 kr først, så sender jeg den i morgen.");
  assert.equal(vipps.kind, "risk");
  assert.equal(vipps.signals.includes("off_platform"), true);

  const cashApp = await detect("Please CashApp me 500 kr, I ship tomorrow.");
  assert.equal(cashApp.kind, "risk");
  assert.equal(cashApp.level, "high");
  assert.deepEqual(cashApp.signals, ["off_platform", "ship_before_meet"]);

  const tag = await detect("Send 500 kr to my $bikeSeller cashtag, I ship tomorrow.");
  assert.equal(tag.kind, "risk");
  assert.equal(tag.level, "high");
  assert.deepEqual(tag.signals, ["off_platform", "ship_before_meet"]);
});

test("ordinary Swish and Vipps lines are not pay-first", async () => {
  const quiet = [
    "Betalning via Swish, 500 kr",
    "Betaling med Vipps, 500 kr"
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
  }
});

test("a refused pickup does not hide Swish, a real pickup offer stays quiet", async () => {
  const ask = await detect("Pay 500 kr by Swish, no pick up possible, I ship tomorrow");
  assert.equal(ask.kind, "risk");
  assert.equal(ask.level, "high");
  assert.deepEqual(ask.signals, ["off_platform", "ship_before_meet"]);

  const offer = await detect("Pay 500 kr by Swish on pickup tomorrow.");
  assert.equal(offer.kind, "silent");
  assert.equal(offer.signals.includes("off_platform"), false);
});

test("negation cancels a rail only when it negates that payment", async () => {
  const flagged = [
    "We cannot meet so Venmo 500 kr",
    "Not local so Zelle me 500 kr",
    "I won't be home so Zelle me 500 kr, I ship tomorrow"
  ];
  for (const text of flagged) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.signals.includes("off_platform"), true, text);
  }
});

test("an English Swish listing is not a pay ask", async () => {
  const verdict = await detect("Payment by Swish or cash, price 500 kr.");
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.signals.includes("off_platform"), false);
});

test("honest Swish pickup offers stay quiet", async () => {
  const quiet = [
    "Paying 500 kr by Swish is no problem at pickup.",
    "Swish 500 kr at pickup, no payment before we meet."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
  }
});

test("a negated list of rails stays quiet", async () => {
  const quiet = [
    "I don't take Venmo or Zelle, the bike is 500 kr and we meet Thursday.",
    "Never pay with Zelle or Venmo, it's 500 kr cash only."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.signals.includes("off_platform"), false, text);
  }
});

test("Swedish Swish asks are off-platform", async () => {
  const asks = [
    "Swisha 500 kr så skickar jag den imorgon.",
    "Betala 500 kr med Swish innan jag skickar cykeln."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
  }
});

test("paying in person or at Swedish pickup stays quiet", async () => {
  const quiet = [
    "Pay 500 kr with Vipps when we meet.",
    "You can pay 500 kr by Swish when we meet in town.",
    "Du kan betala 500 kr med Swish när du hämtar den.",
    "Kan betala 500 kr med Swish vid upphämtning.",
    "Du kan betala 500 kr med Swish när vi ses."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

test("named rails at pickup or when we meet stay quiet", async () => {
  const quiet = [
    "Can I pay $50 with Venmo when I pick it up?",
    "I can pay $50 with Venmo when I pick it up.",
    "Bring cash or pay $80 with Zelle when you come to see it."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

test("a refusal after the pickup word does not hide Swish", async () => {
  const asks = [
    "Pickup isn't possible, pay 500 kr by Swish and I'll ship it.",
    "Pickup is not possible. Pay 500 kr by Swish and I send it."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
  }
});

test("Swish as a verb plus shipping is off-platform", async () => {
  const asks = [
    "Swish me 500 kr now and I ship it today.",
    "Swish 500 kr to 0701234567 and I post it tomorrow.",
    "Swish me 500 kr and I'll send it tomorrow."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
  }
});

test("paying before the handover stays off-platform", async () => {
  const asks = [
    "Send $200 via Western Union and collect the car when it arrives.",
    "Send the money via Zelle first and you can pick it up after.",
    "Pay $300 by Cash App now, I will hold it until you pick it up.",
    "Send 500 kr by Swish now to reserve, you can pick it up Saturday.",
    "Venmo me $50 today so I hold it, pick up Sunday.",
    "Pay $50 with Venmo now and the rest when we meet."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
  }

  const reserve = await detect("Zelle me $100 now to reserve it, then come to see it tomorrow.");
  assert.equal(reserve.kind, "risk");
  assert.equal(reserve.level, "high");
  assert.deepEqual(reserve.signals, ["upfront_deposit", "off_platform"]);

  const deposit = await detect("Send me a $100 Zelle deposit today to hold it, you can pick it up Saturday.");
  assert.equal(deposit.kind, "risk");
  assert.equal(deposit.level, "high");
  assert.deepEqual(deposit.signals, ["upfront_deposit", "off_platform"]);
});

test("a timing word after the handover does not make the rail early", async () => {
  const quiet = [
    "Pay with Zelle when you collect, $90, available now.",
    "You can pay by Cash App when you collect, I'll hold it till then.",
    "Venmo $40 when we meet, I am home today.",
    "Venmo $50 when we meet tomorrow first thing."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

test("a later hold or today still yields to pickup", async () => {
  const quiet = [
    "Pay by Cash App when you pick it up, I can hold it till Saturday.",
    "Pay $70 by Venmo at pickup. I can deliver today if you prefer."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "veto", text);
  }
});

test("in advance flags the deposit, and a split rest and a Swedish hold stay quiet", async () => {
  const advance = await detect("Pay $100 by Venmo in advance, then pay the rest when we meet.");
  assert.equal(advance.kind, "risk");
  assert.equal(advance.level, "medium");
  assert.deepEqual(advance.signals, ["upfront_deposit"]);

  const split = await detect("Zelle me $100 to hold it, pay the rest when you pick it up.");
  assert.equal(split.kind, "silent");
  assert.equal(split.silentReason, "veto");

  const swedish = await detect("Swisha 500 kr nu så håller jag den, hämta på lördag.");
  assert.equal(swedish.kind, "silent");
  assert.equal(swedish.silentReason, "no_atom");
  assert.deepEqual(swedish.signals, []);
});

test("a bare cashtag counts and a dollar amount does not", async () => {
  const tag = await detect("Send 500 kr to $bikeseller, I ship tomorrow");
  assert.equal(tag.kind, "risk");
  assert.equal(tag.level, "high");
  assert.deepEqual(tag.signals, ["off_platform", "ship_before_meet"]);

  const dollars = await detect("Send 500 kr to $500, I ship tomorrow.");
  assert.equal(dollars.kind, "silent");
  assert.equal(dollars.signals.includes("off_platform"), false);
});


test("Amazon card and Steam card without the word gift are off-platform", async () => {
  const medium = [
    "Send an Amazon card of 500 kr today, the bike is ready.",
    "Pay with a Steam card, 500 kr, the bike is ready."
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["off_platform"], text);
  }

  const high = [
    "Send an Amazon card of 500 kr, I ship tomorrow.",
    "Pay with a Steam card, 500 kr, I ship tomorrow."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.deepEqual(verdict.signals, ["off_platform", "ship_before_meet"], text);
  }

  const apple = await detect("Send an Apple gift card of 500 kr, I ship tomorrow.");
  assert.equal(apple.kind, "risk");
  assert.equal(apple.level, "high");
  assert.deepEqual(apple.signals, ["off_platform", "ship_before_meet"]);
});

test("a loyalty card and an engine steam card stay silent", async () => {
  const quiet = [
    "The Amazon card in my wallet is just a loyalty card from the store.",
    "The steam card for the old engine is in the garage today."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});
