import test from "node:test";
import assert from "node:assert/strict";
import { classifyText, resolveLlm, typesafeQuestions } from "../src/classify.js";

const KEY = "test-typesafe-key-not-real";
const CHAT = "Them: Hi, is the bike still for sale?\nMe: Yes\nThem: Great, send the 500 kr deposit via Friends & Family and I will ship it";

function answer(answers, status = 200) {
  return { ok: status < 400, status, async text() { return JSON.stringify({ model: "jev-1.14.0", answers, usage: { input_tokens: 300, output_tokens: 20 } }); } };
}

test("resolveLlm: typesafe by key, explicit, custom key name, base URL and model", () => {
  const auto = resolveLlm({ TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or" });
  assert.equal(auto.provider, "typesafe");
  assert.equal(auto.baseUrl, "https://api.typesafe.ai");
  assert.equal(auto.model, "jev-1.14.0");
  assert.equal(auto.addConfidence, 0.5);
  assert.equal(auto.fallback, null);
  const custom = resolveLlm({ LLM_PROVIDER: "typesafe", TYPESAFE_API_KEY_NAME: "MY_TS", MY_TS: KEY, TYPESAFE_BASE_URL: "https://ts.example/", TYPESAFE_MODEL: "jev-1.13.0" });
  assert.equal(custom.apiKey, KEY);
  assert.equal(custom.baseUrl, "https://ts.example");
  assert.equal(custom.model, "jev-1.13.0");
  assert.equal(resolveLlm({ LLM_PROVIDER: "typesafe" }).configured, false);
  // OpenRouter still works when asked for, and as an opt-in fallback.
  assert.equal(resolveLlm({ LLM_PROVIDER: "openrouter", TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or" }).provider, "openrouter");
  const fb = resolveLlm({ TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or", LLM_FALLBACK: "openrouter" });
  assert.equal(fb.fallback.provider, "openrouter");
});

test("typesafe request: bearer, /v1/systemone, chat as state, Them lines as evidence choices", async () => {
  let seen;
  const out = await classifyText(CHAT, { TYPESAFE_API_KEY: KEY }, async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return answer({ risky: { type: "noul", noul: 0.97 }, signal: { type: "choice", choice: "friends_family" }, evidence: { type: "choice", choice: "l1" } });
  });
  assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen.init.headers.authorization, "Bearer " + KEY);
  assert.equal(seen.body.state, CHAT);
  assert.deepEqual(Object.keys(seen.body.questions.evidence.criteria), ["l0", "l1"]);
  assert.equal(out.risky, true);
  assert.equal(out.level, "high");
  assert.equal(out.confidence, 0.97);
  assert.equal(out.signal, "friends_family");
  assert.deepEqual(out.evidence, ["Great, send the 500 kr deposit via Friends & Family and I will ship it"]);
  assert.equal(out.reason, "");
});

test("typesafe not risky: confidence is 1 - p, no evidence", async () => {
  const out = await classifyText(CHAT, { TYPESAFE_API_KEY: KEY }, async () => answer({ risky: { type: "noul", noul: 0.1 }, signal: { type: "choice", choice: "other" }, evidence: { type: "choice", choice: "l0" } }));
  assert.equal(out.risky, false);
  assert.equal(out.level, "none");
  assert.equal(Math.round(out.confidence * 100), 90);
  assert.deepEqual(out.evidence, []);
});

test("typesafe single message: the whole line is the evidence, no evidence question", async () => {
  const { questions, lines } = typesafeQuestions("Pay the customs fee here: https://x.top/pay");
  assert.equal(questions.evidence, undefined);
  assert.equal(lines.length, 1);
});

test("typesafe error is 502 without the key or body; fallback to OpenRouter when enabled", async () => {
  const bad = async () => ({ ok: false, status: 401, async text() { return "bad key " + KEY; } });
  await assert.rejects(classifyText(CHAT, { TYPESAFE_API_KEY: KEY }, bad), (e) => e.status === 502 && !String(e.message).includes(KEY));
  const calls = [];
  const out = await classifyText(CHAT, { TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or-key", LLM_FALLBACK: "openrouter" }, async (url) => {
    calls.push(url);
    if (url.includes("typesafe")) return bad();
    return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ risky: true, level: "high", confidence: 0.9, signal: "friends_family", reason: "F&F deposit.", evidence: ["Friends & Family"] }) } }] }); } };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith("https://openrouter.ai/api/v1"));
  assert.equal(out.risky, true);
});
