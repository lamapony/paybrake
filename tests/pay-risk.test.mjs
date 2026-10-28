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
  const text = "Buy a €100 gift card and email it to me please.";
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
  const text = "Buy a €100 gift card and email it to me please.";
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

// ---- v3 fixes: the AI can never raise the level; trick-specific advice ----

test("llmMode all: the AI cannot raise a medium rules level to high", async () => {
  // Chat 5 shape: a lone strong credential_request atom is medium by the rules.
  const text = "Before I can send the bike, they need to verify you are a real buyer. I just sent a 6-digit code to your phone, please send me the code here so I can confirm.";
  const verdict = await detect(text, {}, {
    llmMode: "all",
    askLlm: async () => ({ risky: true, level: "high", confidence: 0.97, signal: "credential_request", reason: "x", evidence: ["please send me the code here so I can confirm"] })
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium", "AI raised a medium rules level");
  assert.equal(verdict.rulesLevel, "medium");
});

test("roleplay chats 2, 4 and 5 stay medium when the AI says high", async () => {
  const chats = [
    ["friends and family", "Please send it as friends and family, not goods and services. G&S takes fees and I'm only a private seller. 2500 kr to my PayPal, then I'll ship it tomorrow.", "friends and family"],
    ["off-platform", "Facebook takes a long time to verify buyers. Can you pay me on WhatsApp instead? MobilePay 2500 kr to +45 22 33 44 55 and I'll keep it for you.", "MobilePay"],
    ["verification code", "Before I can send the bike, Facebook needs to verify you are a real buyer. I just sent a 6-digit code to your phone, please send me the code here so I can confirm.", "please send me the code here so I can confirm"]
  ];
  for (const [name, text, quote] of chats) {
    const verdict = await detect(text, {
      listingTitle: "Used road bike",
      listingPrice: "2,500 kr",
      messages: [
        { from: "buyer", text: "Hi! Is the road bike still available?" },
        { from: "seller", text }
      ]
    }, {
      llmMode: "all",
      askLlm: async () => ({ risky: true, level: "high", confidence: 0.99, signal: "off_platform", reason: "Pay immediately by bank transfer.", evidence: [quote] })
    });
    assert.equal(verdict.kind, "risk", name);
    assert.equal(verdict.rulesLevel, "medium", name + " rules");
    assert.equal(verdict.level, "medium", name + " final");
  }
});

test("a verification-code chat does not become a PayPal order when the AI adds a payment signal", async () => {
  const text = "Before I can send the bike, Facebook needs to verify you are a real buyer. I just sent a 6-digit code to your phone, please send me the code here so I can confirm.";
  const verdict = await detect(text, {
    listingTitle: "Used road bike",
    listingPrice: "2,500 kr",
    sellerEmail: "chris@example.com",
    messages: [
      { from: "buyer", text: "Hi! Is the road bike still available?" },
      { from: "seller", text }
    ]
  }, {
    llmMode: "all",
    askLlm: async () => ({ risky: true, level: "high", confidence: 0.99, signal: "off_platform", reason: "Switch to a PayPal order now.", evidence: ["please send me the code here so I can confirm"] })
  });
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.rulesSignals, ["credential_request"]);
  assert.equal(payRisk.isPaymentRisk(verdict), false);
  assert.match(verdict.reason, /never share/i);
  assert.equal(/switch to a paypal order/i.test(verdict.reason), false);
});

test("llmMode all: the AI can still lower a high rules level", async () => {
  const verdict = await detect(FF, {}, {
    llmMode: "all",
    askLlm: async () => ({ risky: true, level: "medium", confidence: 0.9, signal: "friends_family", reason: "x", evidence: ["Friends & Family"] })
  });
  assert.equal(verdict.level, "medium");
  assert.equal(verdict.rulesLevel, "high");
});

test("overpayment chat names the overpay-and-refund trick", async () => {
  const text = "I've paid you 3000 kr instead of 2500 by mistake! To receive the payment confirm your details through this link: paypal-secure-verify.example.com/claim. Then please refund the extra 500 kr by bank transfer.";
  const verdict = await detect(text, {});
  assert.equal(verdict.kind, "risk");
  assert.ok(verdict.signals.includes("overpayment_refund"), verdict.signals.join(","));
  assert.match(verdict.reason, /overpay/i);
  assert.match(verdict.reason, /refund/i);
});

test("gift-card chat names the gift card, not a plain direct transfer", async () => {
  const text = "Today only: if you pay half now with a gift card (Amazon or Steam) I'll hold it for you. Others are interested and the first to pay gets it.";
  const verdict = await detect(text, {});
  assert.equal(verdict.kind, "risk");
  assert.match(verdict.reason, /gift card/i);
  assert.equal(/direct transfer/i.test(verdict.reason), false);
});

test("verification-code advice says never share the code", async () => {
  const text = "Before I can send the bike, they need to verify you are a real buyer. I just sent a 6-digit code to your phone, please send me the code here so I can confirm.";
  const verdict = await detect(text, {});
  assert.match(verdict.reason, /never share/i);
  assert.equal(/switch to a paypal order/i.test(verdict.reason), false);
});
