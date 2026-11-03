import test from "node:test";
import assert from "node:assert/strict";
import { classifyText, capLevel, evidenceIsSubstring, evidencePasses, sanitizeReason } from "../src/classify.js";

const input = "Send 500 kr deposit via PayPal Friends & Family";

test("evidence must be a whitespace-normalized substring", () => {
  assert.equal(evidenceIsSubstring("Friends & Family", "PayPal Friends   &  Family please"), true);
  assert.equal(evidenceIsSubstring("wire it to my cousin", input), false);
  assert.equal(evidencePasses(["Friends & Family", "500 kr"], input), true);
  assert.equal(evidencePasses(["Friends & Family", "not in the text"], input), false);
  assert.equal(evidencePasses([], input), false);
});

test("sanitizeReason drops promise language and overlong text", () => {
  const fallback = "Risky payment request: a direct transfer may be hard to get back if the item never arrives.";
  assert.equal(sanitizeReason("You are protected if you pay now", fallback), fallback);
  assert.equal(sanitizeReason("x".repeat(121), fallback), fallback);
  assert.equal(sanitizeReason("Deposit via Friends & Family is hard to recover.", fallback), "Deposit via Friends & Family is hard to recover.");
});

test("empty LLM_BASE_URL is llm_off and does not call fetch", async () => {
  let called = 0;
  await assert.rejects(
    () => classifyText(input, { LLM_BASE_URL: "" }, () => { called += 1; }),
    (error) => error.code === "llm_off"
  );
  assert.equal(called, 0);
});

test("fetch wrapper sends temperature 0 and the evidence guard rejects a fabricated quote", async () => {
  let body;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body);
    assert.equal(url.endsWith("/chat/completions"), true);
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            risky: true,
            level: "high",
            reason: "Looks bad",
            evidence: ["invented quote"],
            item: null,
            amount: null,
            currency: null
          }) } }]
        });
      }
    };
  };
  const result = await classifyText(input, { LLM_BASE_URL: "http://llm.test/v1", LLM_MODEL: "demo" }, fetchImpl);
  assert.equal(body.temperature, 0);
  assert.equal(body.model, "demo");
  assert.equal(result.risky, false);
  assert.deepEqual(result.evidence, []);
});

test("a verbatim quote is kept", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          risky: true,
          level: "high",
          reason: "Friends & Family plus a deposit is hard to recover.",
          evidence: ["Friends & Family"],
          item: "bike",
          amount: 500,
          currency: "DKK"
        }) } }]
      });
    }
  });
  const result = await classifyText(input, { LLM_BASE_URL: "http://llm.test/v1" }, fetchImpl);
  assert.equal(result.risky, true);
  assert.equal(result.level, "high");
  assert.deepEqual(result.evidence, ["Friends & Family"]);
  assert.equal(result.amount, 500);
});

test("capLevel never raises above the rules level", () => {
  assert.equal(capLevel("high", "medium"), "medium");
  assert.equal(capLevel("medium", "high"), "medium");
  assert.equal(capLevel("high", "high"), "high");
  assert.equal(capLevel("medium", ""), "medium");
  assert.equal(capLevel("high", null), "high");
  // Rules found nothing. "none" is not a cap, so the model can still add a card.
  assert.equal(capLevel("high", "none"), "high");
  assert.equal(capLevel("medium", "none"), "medium");
});

test("rulesLevel argument caps the AI level and none does not", async () => {
  const llmFetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          risky: true, level: "high", confidence: 0.95, reason: "Friends & Family.",
          evidence: ["Friends & Family"], item: null, amount: null, currency: null
        }) } }]
      });
    }
  });
  const base = { LLM_BASE_URL: "http://llm.test/v1", LLM_MODEL: "demo" };
  const capped = await classifyText(input, base, llmFetch, "medium");
  assert.equal(capped.level, "medium");
  const free = await classifyText(input, base, llmFetch);
  assert.equal(free.level, "high");
  // A rules level stuffed into env must not cap, and "none" must not wipe the card.
  const fromEnv = await classifyText(input, { ...base, PAYBRAKE_RULES_LEVEL: "medium" }, llmFetch);
  assert.equal(fromEnv.level, "high");
  const silentRules = await classifyText(input, base, llmFetch, "none");
  assert.equal(silentRules.level, "high");
});

test("a 200 chat body that is not the expected JSON is llm shape", async () => {
  await assert.rejects(
    () => classifyText(input, { LLM_BASE_URL: "http://llm.test/v1" }, async () => ({
      ok: true,
      status: 200,
      async text() { return "not json"; }
    })),
    (error) => error.status === 502 && error.message === "llm shape"
  );
});
