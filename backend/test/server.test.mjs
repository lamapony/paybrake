import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

const baseEnv = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "",
  PAYPAL_ADAPTER: "mock",
  LLM_BASE_URL: "",
  ALLOWED_ORIGINS: "http://localhost:8080,http://127.0.0.1:8080"
};

async function listen(env = baseEnv, deps) {
  const server = createServer(env, deps);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port, url: `http://127.0.0.1:${port}` };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("GET /health reports mock and llm off", async () => {
  const { server, url } = await listen();
  try {
    const res = await fetch(url + "/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.env, "sandbox");
    assert.equal(body.paypal, "mock");
    assert.equal(body.llm, "off");
  } finally {
    await close(server);
  }
});

test("protect returns a MOCK id and approve URL, then capture completes", async () => {
  const { server, url } = await listen();
  try {
    const createdRes = await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item: "Used road bike",
        amount: 1800,
        currency: "dkk",
        payeeEmail: "jonas.holm@example.com",
        verdict: { level: "high", signals: ["friends_family"] }
      })
    });
    assert.equal(createdRes.status, 200);
    const created = await createdRes.json();
    assert.match(created.orderId, /^MOCK-/);
    assert.equal(created.status, "CREATED");
    assert.equal(created.mode, "mock");
    assert.match(created.approveUrl, new RegExp("token=" + created.orderId));

    const early = await fetch(url + "/api/orders/" + created.orderId + "/capture", { method: "POST" });
    assert.equal(early.status, 409);

    const approved = await fetch(url + "/api/orders/" + created.orderId + "/approve-mock", { method: "POST" });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).status, "APPROVED");

    const got = await fetch(url + "/api/orders/" + created.orderId);
    assert.equal((await got.json()).status, "APPROVED");

    const captured = await fetch(url + "/api/orders/" + created.orderId + "/capture", { method: "POST" });
    assert.equal(captured.status, 200);
    const done = await captured.json();
    assert.equal(done.status, "COMPLETED");
    assert.match(done.captureId, /^MOCK-CAP-/);
  } finally {
    await close(server);
  }
});

test("GET /return marks the mock order approved", async () => {
  const { server, url } = await listen();
  try {
    const created = await (await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: "Lamp", amount: 250, currency: "DKK", payeeEmail: "mette.lund@example.com" })
    })).json();
    const redirected = await fetch(url + "/return?token=" + created.orderId, { redirect: "manual" });
    assert.equal(redirected.status, 302);
    assert.match(redirected.headers.get("location"), /checkout-return\.html/);
    assert.match(redirected.headers.get("location"), /mock=1/);
    const status = await (await fetch(url + "/api/orders/" + created.orderId)).json();
    assert.equal(status.status, "APPROVED");
  } finally {
    await close(server);
  }
});

test("bad protect body is 400 and a huge body is 413", async () => {
  const { server, url } = await listen();
  try {
    const bad = await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "bad_request");

    const empty = await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(empty.status, 400);

    const huge = await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: "x".repeat(20 * 1024), amount: 1, currency: "DKK" })
    });
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).error, "payload_too_large");
  } finally {
    await close(server);
  }
});

test("classify is 503 llm_off when LLM_BASE_URL is empty", async () => {
  const { server, url } = await listen();
  try {
    const res = await fetch(url + "/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Send 500 kr via Friends & Family" })
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "llm_off" });
  } finally {
    await close(server);
  }
});

test("CORS allows the demo origin and any chrome-extension origin", async () => {
  const { server, url } = await listen();
  try {
    const demo = await fetch(url + "/health", { headers: { origin: "http://localhost:8080" } });
    assert.equal(demo.headers.get("access-control-allow-origin"), "http://localhost:8080");

    const ext = await fetch(url + "/health", { headers: { origin: "chrome-extension://abcdefghijklmnop" } });
    assert.equal(ext.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");

    const evil = await fetch(url + "/health", { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(url + "/api/protect", {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:8080", "access-control-request-method": "POST" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:8080");
  } finally {
    await close(server);
  }
});

test("createServer refuses PAYPAL_ENV=live", () => {
  assert.throws(() => createServer({ PAYPAL_ENV: "live", PAYPAL_CLIENT_ID: "" }), /sandbox/);
});
