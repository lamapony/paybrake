import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

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
