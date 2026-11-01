import test from "node:test";
import assert from "node:assert/strict";
import { tinyJudge, payRisk } from "../extension/lib/index.js";

const { packPrompt, decide, PROMPT_CAP } = tinyJudge;
const { detect } = payRisk;

const MESSAGE = "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow";

function rules() {
  return { level: "high", signals: ["friends_family", "upfront_deposit"] };
}

test("the judge prompt stays inside a tiny context", () => {
  const prompt = packPrompt(MESSAGE, rules());
  assert.ok(prompt.length <= PROMPT_CAP, String(prompt.length));
  assert.match(prompt, /LEVEL: high/);
  assert.match(prompt, /Do not raise/);
  const huge = packPrompt("x".repeat(8000), rules());
  assert.ok(huge.length <= PROMPT_CAP);
});

test("a confirm cannot raise medium to high", () => {
  const decision = decide(
    '{"v":"confirm","lv":"high","q":"500 kr deposit","why":"ff_deposit"}',
    MESSAGE,
    { level: "medium", signals: ["upfront_deposit"] }
  );
  assert.equal(decision.action, "keep");
  assert.equal(decision.level, "medium");
});

test("lower drops high to medium", () => {
  const decision = decide(
    'Sure. {"v":"lower","lv":"high","q":"Friends & Family","why":"ff"}',
    MESSAGE,
    rules()
  );
  assert.equal(decision.action, "keep");
  assert.equal(decision.level, "medium");
});

test("a quote that is not in the message rejects the hit", () => {
  const decision = decide(
    '{"v":"confirm","lv":"high","q":"wire the money tonight","why":"off"}',
    MESSAGE,
    rules()
  );
  assert.equal(decision.action, "reject");
  assert.equal(decision.reason, "quote");
});

test("rambling text with no JSON is an error, not a new card", () => {
  const decision = decide("I think this looks risky overall.", MESSAGE, rules());
  assert.equal(decision.action, "error");
});

test("the browser judge is not called when no atom fired", async () => {
  let calls = 0;
  const verdict = await detect("Yes the bike is still available and the tyres are new.", {}, {
    askJudge: async () => {
      calls += 1;
      return '{"v":"confirm","lv":"high","q":"bike","why":"generic"}';
    }
  });
  assert.equal(verdict.kind, "silent");
  assert.equal(calls, 0);
});

test("a reject from the tiny judge hides the card", async () => {
  const verdict = await detect(MESSAGE, {}, {
    askJudge: async () => '{"v":"reject","lv":"none","q":"Friends & Family","why":"ff"}'
  });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "llm_disagrees");
  assert.equal(verdict.judge, "rejected");
});

test("model_off keeps the rules level", async () => {
  const verdict = await detect(MESSAGE, {}, {
    askJudge: async () => {
      const error = new Error("model_off");
      error.code = "model_off";
      throw error;
    }
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.equal(verdict.judge, "off");
  assert.equal(verdict.llm, "off");
});

test("a bad model reply caps a high hit at medium", async () => {
  const verdict = await detect(MESSAGE, {}, {
    askJudge: async () => "not json"
  });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.equal(verdict.judge, "error");
});

test("overpay plus a label fee is high before the judge runs", async () => {
  const verdict = await detect(
    "Pay 1,600 kr and I will refund the difference. Also pay the 80 kr shipping label fee first.",
    {}
  );
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "high");
  assert.ok(verdict.signals.includes("overpayment_refund"));
  assert.ok(verdict.signals.includes("label_fee"));
});

test("a prize gift card stays silent", async () => {
  const verdict = await detect("Congratulations, you won a free gift card as a prize with this camera.", {});
  assert.equal(verdict.kind, "silent");
});
