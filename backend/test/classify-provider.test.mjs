import test from "node:test";
import assert from "node:assert/strict";
import { classifyText, resolveLlm } from "../src/classify.js";
import { createServer } from "../src/server.js";

const KEY = "test-openrouter-key-not-real";
const INPUT = "Send 500 kr deposit via PayPal Friends & Family";
const SYSTEM = "You judge whether a marketplace chat asks for a risky payment. Reply with JSON only: {risky:boolean, level:\"high\"|\"medium\"|\"none\", reason:string<=120, evidence:string[], item:string|null, amount:number|null, currency:string|null}. Every evidence string must be a verbatim substring of the user text. Do not promise a refund.";

function chat(content) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ choices: [{ message: { content } }] });
    }
  };
}

function verdictJson(extra = {}) {
  return JSON.stringify({
    risky: true,
    level: "high",
    reason: "Friends & Family plus a deposit is hard to recover.",
    evidence: ["Friends & Family"],
    item: null,
    amount: null,
    currency: null,
    ...extra
  });
}

async function listen(env, deps) {
  const server = createServer(env, deps);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("resolveLlm covers openrouter, openai-compatible, back-compat, and off", () => {
  const openrouter = resolveLlm({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY });
  assert.equal(openrouter.configured, true);
  assert.equal(openrouter.provider, "openrouter");
  assert.equal(openrouter.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openrouter.apiKey, KEY);
  assert.equal(openrouter.model, "openai/gpt-4o-mini");
  assert.equal(openrouter.timeoutMs, 8000);

  const missing = resolveLlm({ LLM_PROVIDER: "openrouter", LLM_BASE_URL: "https://openrouter.ai/api/v1" });
  assert.equal(missing.configured, false);
  assert.equal(missing.provider, "off");
  assert.equal(missing.apiKey, "");
  assert.equal(missing.baseUrl, "");

  const fallback = resolveLlm({
    LLM_PROVIDER: " OpenRouter ",
    LLM_API_KEY: KEY,
    LLM_BASE_URL: "https://openrouter.ai/api/v1/",
    LLM_MODEL: "custom/model",
    LLM_TIMEOUT_MS: "2500"
  });
  assert.equal(fallback.configured, true);
  assert.equal(fallback.provider, "openrouter");
  assert.equal(fallback.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(fallback.apiKey, KEY);
  assert.equal(fallback.model, "custom/model");
  assert.equal(fallback.timeoutMs, 2500);

  const prefersOpenRouterKey = resolveLlm({
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: KEY,
    LLM_API_KEY: "other-llm-key"
  });
  assert.equal(prefersOpenRouterKey.apiKey, KEY);

  const local = resolveLlm({
    LLM_PROVIDER: "openai-compatible",
    LLM_BASE_URL: "http://127.0.0.1:11434/v1/",
    LLM_TIMEOUT_MS: "1500"
  });
  assert.equal(local.configured, true);
  assert.equal(local.provider, "openai-compatible");
  assert.equal(local.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(local.apiKey, "");
  assert.equal(local.model, "gpt-4o-mini");
  assert.equal(local.timeoutMs, 1500);

  const localOff = resolveLlm({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: KEY });
  assert.equal(localOff.configured, false);
  assert.equal(localOff.provider, "off");
  assert.equal(localOff.apiKey, "");

  const backCompat = resolveLlm({
    LLM_BASE_URL: "http://llm.test/v1",
    OPENROUTER_API_KEY: KEY,
    LLM_API_KEY: "local-key"
  });
  assert.equal(backCompat.configured, true);
  assert.equal(backCompat.provider, "openai-compatible");
  assert.equal(backCompat.baseUrl, "http://llm.test/v1");
  assert.equal(backCompat.apiKey, "local-key");
  assert.equal(backCompat.model, "gpt-4o-mini");

  const alone = resolveLlm({ OPENROUTER_API_KEY: `  ${KEY}  ` });
  assert.equal(alone.configured, true);
  assert.equal(alone.provider, "openrouter");
  assert.equal(alone.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(alone.apiKey, KEY);
  assert.equal(alone.model, "openai/gpt-4o-mini");

  const off = resolveLlm({
    LLM_PROVIDER: "off",
    OPENROUTER_API_KEY: KEY,
    LLM_API_KEY: KEY,
    LLM_BASE_URL: "http://llm.test/v1"
  });
  assert.equal(off.configured, false);
  assert.equal(off.provider, "off");
  assert.equal(off.apiKey, "");
  assert.equal(off.baseUrl, "");
  assert.equal(off.model, "");

  const empty = resolveLlm({});
  assert.equal(empty.configured, false);
  assert.equal(empty.provider, "off");
  assert.equal(empty.timeoutMs, 8000);
  assert.equal(empty.apiKey, "");
});

test("openrouter classify sends bearer, referer, title, temperature 0, and json_object", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return chat(verdictJson());
  };
  const result = await classifyText(INPUT, { LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY }, fetchImpl);
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(seen.init.headers["HTTP-Referer"], "https://github.com/lamapony/paybrake");
  assert.equal(seen.init.headers["X-Title"], "PayBrake");
  assert.ok(seen.init.signal instanceof AbortSignal);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.model, "openai/gpt-4o-mini");
  assert.equal(body.messages[0].content, SYSTEM);
  assert.equal(body.messages[1].content, INPUT);
  assert.equal(result.risky, true);
  assert.equal(result.level, "high");
  assert.deepEqual(result.evidence, ["Friends & Family"]);
});

test("openai-compatible omits bearer and OpenRouter headers when no key is set", async () => {
  let init;
  const fetchImpl = async (url, options) => {
    init = options;
    assert.equal(url, "http://llm.test/v1/chat/completions");
    return chat(verdictJson({ risky: false, evidence: [] }));
  };
  const result = await classifyText(INPUT, { LLM_BASE_URL: "http://llm.test/v1/" }, fetchImpl);
  assert.equal(init.headers.authorization, undefined);
  assert.equal(init.headers["HTTP-Referer"], undefined);
  assert.equal(init.headers["X-Title"], undefined);
  assert.equal(JSON.parse(init.body).model, "gpt-4o-mini");
  assert.equal(result.risky, false);
});

test("openrouter without a key is 503 and does not call fetch", async () => {
  let calls = 0;
  await assert.rejects(
    () => classifyText(INPUT, { LLM_PROVIDER: "openrouter" }, () => { calls += 1; }),
    (error) => error.status === 503 && error.code === "llm_off"
  );
  assert.equal(calls, 0);
});

test("fabricated evidence forces risky false", async () => {
  const fetchImpl = async () => chat(verdictJson({ evidence: ["invented quote"], level: "high" }));
  const result = await classifyText(INPUT, { LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY }, fetchImpl);
  assert.equal(result.risky, false);
  assert.equal(result.level, "none");
  assert.deepEqual(result.evidence, []);
  assert.equal(result.reason, "");
});

test("a non-high level stays medium when the evidence guard passes", async () => {
  const fetchImpl = async () => chat(verdictJson({ level: "critical" }));
  const result = await classifyText(INPUT, { LLM_BASE_URL: "http://llm.test/v1" }, fetchImpl);
  assert.equal(result.risky, true);
  assert.equal(result.level, "medium");
});

test("fenced JSON content parses", async () => {
  const fenced = "```json\n" + verdictJson({ level: "medium", item: "bike", amount: 500, currency: "DKK" }) + "\n```";
  const fetchImpl = async () => chat(fenced);
  const result = await classifyText(INPUT, { LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY }, fetchImpl);
  assert.equal(result.risky, true);
  assert.equal(result.level, "medium");
  assert.equal(result.item, "bike");
  assert.equal(result.amount, 500);
  assert.equal(result.currency, "DKK");
  assert.deepEqual(result.evidence, ["Friends & Family"]);
});

test("provider 500 does not echo the key in the error or the HTTP body", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    async text() {
      return `upstream failed key=${KEY} prompt=${INPUT}`;
    }
  });
  await assert.rejects(
    () => classifyText(INPUT, { LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY }, fetchImpl),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, "llm_error");
      assert.equal(error.message, "llm 500");
      assert.equal(error.message.includes(KEY), false);
      assert.equal(error.message.includes(INPUT), false);
      return true;
    }
  );

  const env = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "",
    PAYPAL_ADAPTER: "mock",
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: KEY
  };
  const { server, url } = await listen(env, { fetchImpl });
  try {
    const res = await fetch(url + "/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: INPUT })
    });
    const raw = await res.text();
    assert.equal(res.status, 502);
    assert.deepEqual(JSON.parse(raw), { error: "llm_error" });
    assert.equal(raw.includes(KEY), false);
    assert.equal(raw.includes(INPUT), false);
  } finally {
    await close(server);
  }
});

test("a thrown fetch is 502 and the message omits the transport text", async () => {
  const fetchImpl = async () => {
    throw new Error(`timeout while calling provider with ${KEY}`);
  };
  await assert.rejects(
    () => classifyText(INPUT, {
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "http://llm.test/v1",
      LLM_API_KEY: KEY
    }, fetchImpl),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, "llm_error");
      assert.equal(error.message, "llm error");
      assert.equal(error.message.includes(KEY), false);
      assert.equal(error.message.includes("timeout"), false);
      return true;
    }
  );
});

test("non-JSON provider output is 502 and drops the body", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return `not-json ${KEY}`;
    }
  });
  await assert.rejects(
    () => classifyText(INPUT, { LLM_BASE_URL: "http://llm.test/v1", LLM_API_KEY: KEY }, fetchImpl),
    (error) => error.status === 502 && error.code === "llm_error" && error.message === "llm 200" && !error.message.includes(KEY)
  );
});

test("text longer than 4000 characters is 400 and does not call fetch", async () => {
  let calls = 0;
  const env = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "",
    LLM_BASE_URL: "http://llm.test/v1"
  };
  await assert.rejects(
    () => classifyText("a".repeat(4001), env, () => { calls += 1; }),
    (error) => error.status === 400 && error.code === "bad_request" && error.message === "text is too long"
  );
  assert.equal(calls, 0);

  const { server, url } = await listen(env, { fetchImpl: () => { calls += 1; } });
  try {
    const res = await fetch(url + "/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "b".repeat(4001) })
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_request", message: "text is too long" });
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test("health with only OPENROUTER_API_KEY reports openrouter and omits the key", async () => {
  const env = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "",
    OPENROUTER_API_KEY: KEY
  };
  const { server, url } = await listen(env);
  try {
    const res = await fetch(url + "/health");
    const raw = await res.text();
    assert.equal(res.status, 200);
    const body = JSON.parse(raw);
    assert.equal(body.llm, "configured");
    assert.equal(body.llmProvider, "openrouter");
    assert.equal(body.paypal, "mock");
    assert.equal(raw.includes(KEY), false);
    assert.equal(raw.includes("openai/gpt-4o-mini"), false);
  } finally {
    await close(server);
  }
});

test("POST /api/classify is 503 when no provider key is configured", async () => {
  let calls = 0;
  const env = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "",
    LLM_PROVIDER: "openrouter"
  };
  const { server, url } = await listen(env, { fetchImpl: () => { calls += 1; } });
  try {
    const res = await fetch(url + "/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: INPUT })
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "llm_off" });
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});
