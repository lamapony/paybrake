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

test("typesafe extra questions: lift p(risky) only at their own bar, and name the signal", async () => {
  const SMS = "Them: You have won a 1000 pound prize! Call 09061701461 now to claim.";
  const ask = (extra) => classifyText(SMS, { TYPESAFE_API_KEY: KEY }, async (url, init) => {
    const q = JSON.parse(init.body).questions;
    assert.deepEqual(["premium", "prize", "lure"].filter((k) => q[k] && q[k].type === "noul"), ["premium", "prize", "lure"]);
    return answer({ risky: { type: "noul", noul: 0.2 }, signal: { type: "choice", choice: "other" }, ...extra });
  });
  const lifted = await ask({ premium: { noul: 0.3 }, prize: { noul: 0.92 }, lure: { noul: 0.1 } });
  assert.equal(lifted.risky, true);
  assert.equal(lifted.level, "high");
  assert.equal(lifted.confidence, 0.92);
  assert.equal(lifted.signal, "prize_bait");
  assert.deepEqual(lifted.evidence, ["You have won a 1000 pound prize! Call 09061701461 now to claim."]);
  // Below its bar (prize 0.7) an extra does nothing: still "not risky" at 1 - 0.2.
  const under = await ask({ premium: { noul: 0.4 }, prize: { noul: 0.69 }, lure: { noul: 0.6 } });
  assert.equal(under.risky, false);
  assert.equal(under.confidence, 0.8);
});

test("typesafe bait signal: a fired extra names its signal unless the main signal is a concrete money ask", async () => {
  const SMS = "Them: Claim your free Nitro here before it expires: https://dlscord-gift.example/nitro";
  const ask = (signal, extra) => classifyText(SMS, { TYPESAFE_API_KEY: KEY }, async () =>
    answer({ risky: { noul: 0.93 }, signal: { type: "choice", choice: signal }, premium: { noul: 0.01 }, prize: { noul: 0.2 }, ...extra }));
  // Main question already says risky (0.93) with a vague signal: the fired lure question still names the card.
  assert.equal((await ask("urgency_pressure", { lure: { noul: 0.88 } })).signal, "free_bait");
  assert.equal((await ask("phishing_link", { lure: { noul: 0.88 } })).signal, "free_bait");
  // A concrete money ask wins.
  assert.equal((await ask("off_platform", { lure: { noul: 0.88 } })).signal, "off_platform");
  // Under its bar (0.7) the lure question changes nothing.
  assert.equal((await ask("urgency_pressure", { lure: { noul: 0.6 } })).signal, "urgency_pressure");
  // Two fired extras: the stronger one names the signal.
  const both = await ask("other", { premium: { noul: 0.97 }, lure: { noul: 0.75 } });
  assert.equal(both.signal, "prize_bait");
  assert.equal(both.confidence, 0.97);
});
