import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { payRisk, scamModel } from "../extension/lib/index.js";

const { detect } = payRisk;
const root = new URL("../", import.meta.url);
const results = JSON.parse(readFileSync(new URL("research/chat-scams/model-results.json", root), "utf8"));
const cases = JSON.parse(readFileSync(new URL("eval/cases/pay-risk.json", root), "utf8")).cases;

const PRIZE = [
  { from: "seller", text: "Congratulations! Your number was selected in our annual customer draw and you have won a brand new iPhone." },
  { from: "seller", text: "To claim your reward please confirm your full name and address within 24 hours or it will be given to another winner." }
];
const SAFE = [
  { from: "buyer", text: "Is the lamp still for sale?" },
  { from: "seller", text: "Yes it is! You can come see it tomorrow after work, I'm home from 5." },
  { from: "buyer", text: "Great, see you then" }
];
const join = (messages) => messages.map((m) => m.text).join("\n");

test("shipped weights load, are small, and match the trained model's reported version", () => {
  const info = scamModel.info();
  assert.ok(info, "weights decode");
  assert.equal(info.version, results.version);
  assert.equal(info.threshold, results.threshold);
  const bytes = statSync(new URL("extension/lib/scam-model-weights.js", root)).size;
  assert.ok(bytes < 30 * 1024 * 1024, "under the 30 MB budget");
  assert.ok(bytes < 1024 * 1024, "currently under 1 MB: " + bytes);
});

test("browser scoring reproduces the trainer's probabilities on the marketplace cases", () => {
  const byId = Object.fromEntries(results.rows.cases.map((r) => [r.id, r.p]));
  for (const c of cases) {
    const got = scamModel.score(join(c.messages), { messages: c.messages });
    // No counterparty text: the browser returns null, the trainer records 0.
    const p = got ? got.p : 0;
    assert.ok(Math.abs(p - byId[c.id]) < 2e-4, `${c.id}: ${p} vs ${byId[c.id]}`);
  }
});

test("featurize is deterministic, normalized, and ignores the user's own lines", () => {
  const a = scamModel.featurize("Send 500 kr NOW via https://example.com/pay", 18);
  const b = scamModel.featurize("send 900 kr now via https://other.example/x", 18);
  assert.deepEqual([...a.idx], [...b.idx], "digits and URLs are normalized");
  const norm = Math.sqrt([...a.val].reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5);
  const text = scamModel.counterpartyText([{ from: "buyer", text: "mine" }, { from: "seller", text: "theirs" }]);
  assert.equal(text, "theirs");
  assert.equal(scamModel.score("", { messages: [{ from: "buyer", text: "only me talking here, nothing else" }] }), null);
});

test("without localModel, detect() is unchanged rules", async () => {
  const v = await detect(join(PRIZE), { messages: PRIZE });
  assert.equal(v.kind, "silent");
  assert.equal(v.model, undefined);
});

test("the model adds a medium card when rules find no ask, with verbatim evidence", async () => {
  const raw = join(PRIZE);
  const v = await detect(raw, { messages: PRIZE }, { localModel: true });
  assert.equal(v.kind, "risk");
  assert.equal(v.level, "medium");
  assert.equal(v.source, "model");
  assert.deepEqual(v.signals, ["model_flag"]);
  assert.ok(v.modelScore.p >= v.modelScore.threshold);
  assert.ok(v.evidence.length === 1 && raw.slice(v.evidence[0].start, v.evidence[0].end) === v.evidence[0].text);
  assert.match(v.reason, /reads like known scam chats/);
  assert.equal(payRisk.isPaymentRisk(v), false, "no amount, so no PayPal action");
});

test("the model stays quiet on an ordinary pickup chat", async () => {
  const v = await detect(join(SAFE), { messages: SAFE }, { localModel: true });
  assert.equal(v.kind, "silent");
  assert.equal(v.model, "quiet");
});

test("the model never raises or replaces a rules card, and never overrides a veto", async () => {
  const text = "Please send the 500 kr deposit by PayPal Friends and Family before I ship.";
  const plain = await detect(text);
  const withModel = await detect(text, {}, { localModel: true });
  assert.equal(plain.kind, "risk");
  assert.equal(withModel.level, plain.level);
  assert.deepEqual(withModel.signals, plain.signals);
  assert.equal(withModel.source, "rules");

  // A checkout veto stays silent even with a scam-like line in the chat.
  const vetoed = [...PRIZE, { from: "seller", text: "Anyway, please just pay through the Marketplace checkout when you buy." }];
  const rules = await detect(join(vetoed), { messages: vetoed });
  const v = await detect(join(vetoed), { messages: vetoed }, { localModel: true });
  if (rules.silentReason === "veto") assert.equal(v.kind, "silent");
});

test("the user's own scam-sounding words never trigger the model", async () => {
  const mine = PRIZE.map((m) => ({ ...m, from: "buyer" })).concat({ from: "seller", text: "Ha, sounds like spam. Bike is still here, come Saturday." });
  const v = await detect(join(mine), { messages: mine }, { localModel: true });
  assert.equal(v.kind, "silent");
});

test("the server AI can confirm a model card or clear it with high confidence", async () => {
  const raw = join(PRIZE);
  const yes = async () => ({ risky: true, level: "high", confidence: 0.95, signal: "prize_bait", evidence: [PRIZE[0].text], reason: "Prize bait." });
  const v1 = await detect(raw, { messages: PRIZE }, { localModel: true, askLlm: yes, llmMode: "all" });
  assert.equal(v1.kind, "risk");
  assert.equal(v1.llm, "confirmed");
  assert.equal(v1.level, "medium", "the AI cannot raise the model's medium card");

  const no = async () => ({ risky: false, level: "none", confidence: 0.97, evidence: [] });
  const v2 = await detect(raw, { messages: PRIZE }, { localModel: true, askLlm: no, llmMode: "all" });
  assert.equal(v2.kind, "silent");
  assert.equal(v2.silentReason, "llm_disagrees");

  const down = async () => { throw Object.assign(new Error("x"), { code: "timeout" }); };
  const v3 = await detect(raw, { messages: PRIZE }, { localModel: true, askLlm: down, llmMode: "all" });
  assert.equal(v3.kind, "risk", "AI unreachable: the on-device card stands");
  assert.equal(v3.llm, "unavailable");
});

test("missing or broken weights fall back to rules only", async () => {
  const saved = globalThis.pbScamModelWeights;
  try {
    for (const broken of [undefined, { ...saved, weights: "AAAA" }, { ...saved, featureVersion: 99 }]) {
      globalThis.pbScamModelWeights = broken;
      scamModel.reset();
      assert.equal(scamModel.available(), false);
      const v = await detect(join(PRIZE), { messages: PRIZE }, { localModel: true });
      assert.equal(v.kind, "silent");
      assert.equal(v.model, "unavailable");
      const r = await detect("Please send the 500 kr deposit by PayPal Friends and Family before I ship.", {}, { localModel: true });
      assert.equal(r.kind, "risk", "rules still work");
    }
  } finally {
    globalThis.pbScamModelWeights = saved;
    scamModel.reset();
  }
  assert.equal(scamModel.available(), true);
});

test("with the model on, the 35 marketplace cases keep their expected verdicts", async () => {
  for (const c of cases) {
    const v = await detect(join(c.messages), { ...c.context, messages: c.messages }, { localModel: true });
    assert.equal(v.kind === "risk" ? "risk" : "silent", c.expect, c.id);
  }
});
