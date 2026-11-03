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

test("as a gift between send and the phrase is friends and family", async () => {
  const medium = [
    "Please send 500 kr as a gift via PayPal.",
    "Please send 500 kroner as a gift via PayPal today."
  ];
  for (const text of medium) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.ok(verdict.signals.includes("friends_family"), text);
  }
  const high = [
    "Please send 500 kr as a gift via PayPal today, I ship tomorrow.",
    "Send it as a gift on PayPal, 500 kr, I ship tomorrow."
  ];
  for (const text of high) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "high", text);
    assert.ok(verdict.signals.includes("friends_family"), text);
    assert.ok(verdict.signals.includes("ship_before_meet"), text);
  }
});

test("som gave is friends and family", async () => {
  const quiet = await detect("Send 500 kr som gave via PayPal.");
  assert.equal(quiet.kind, "risk");
  assert.ok(quiet.signals.includes("friends_family"));

  const shipped = await detect("Send 500 kr som gave via PayPal nu. Jeg kan kun sende varen.");
  assert.equal(shipped.kind, "risk");
  assert.equal(shipped.level, "high");
  assert.ok(shipped.signals.includes("friends_family"));
  assert.ok(shipped.signals.includes("ship_before_meet"));
});

test("gift wording controls stay put", async () => {
  const lamp = await detect("My friends and family loved this lamp.");
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "no_atom");

  const sister = await detect("Det er en gave til min søster, ikke et salg. Du kan hente den i morgen.");
  assert.equal(sister.kind, "silent");
  assert.equal(sister.silentReason, "no_atom");

  const exact = await detect("Please send as gift via PayPal, 500 kr, I ship tomorrow.");
  assert.equal(exact.kind, "risk");
  assert.equal(exact.level, "high");
  assert.ok(exact.signals.includes("friends_family"));
  assert.ok(exact.signals.includes("ship_before_meet"));

  const card = await detect("Send a gift card for 500 kr via email.");
  assert.equal(card.kind, "risk");
  assert.equal(card.level, "medium");
  assert.deepEqual(card.signals, ["off_platform"]);
});
