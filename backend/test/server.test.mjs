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

test("rest protect returns the PayPal id and responses omit credentials", async () => {
  const secret = "test-secret-not-real";
  const accessToken = "A-TEST-TOKEN";
  const logs = [];
  const paypalUrls = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map((part) => String(part)).join(" "));
  };
  let captures = 0;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    paypalUrls.push(target);
    if (target.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3200 }), { status: 200 });
    }
    if (target.endsWith("/v2/checkout/orders") && (init.method || "GET") === "POST") {
      return new Response(JSON.stringify({
        id: "ORDER-REST-1",
        status: "CREATED",
        links: [
          { rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-REST-1" },
          { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-REST-1&payer-action=1" }
        ]
      }), { status: 200 });
    }
    if (target.endsWith("/capture")) {
      captures += 1;
      if (captures === 1) {
        return new Response(JSON.stringify({
          name: "UNPROCESSABLE_ENTITY",
          message: accessToken,
          details: [{ issue: "ORDER_NOT_APPROVED", description: secret }]
        }), { status: 422 });
      }
      return new Response(JSON.stringify({
        name: "INTERNAL_SERVER_ERROR",
        message: accessToken + " " + secret
      }), { status: 500 });
    }
    return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
  };
  const env = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_ADAPTER: "rest",
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: secret,
    PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    LLM_BASE_URL: "",
    ALLOWED_ORIGINS: "http://localhost:8080,http://127.0.0.1:8080"
  };
  const bodies = [];
  const { server, url } = await listen(env, { fetchImpl });
  try {
    const healthRes = await fetch(url + "/health");
    const healthText = await healthRes.text();
    bodies.push(healthText);
    assert.equal(healthRes.status, 200);
    assert.equal(JSON.parse(healthText).paypal, "rest");

    const createdRes = await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item: "Used road bike",
        amount: 1800,
        currency: "dkk",
        payeeEmail: "jonas.holm@example.com"
      })
    });
    const createdText = await createdRes.text();
    bodies.push(createdText);
    assert.equal(createdRes.status, 200);
    const created = JSON.parse(createdText);
    assert.equal(created.orderId, "ORDER-REST-1");
    assert.equal(created.mode, "rest");
    assert.equal(created.approveUrl, "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-REST-1&payer-action=1");

    const earlyRes = await fetch(url + "/api/orders/ORDER-REST-1/capture", { method: "POST" });
    const earlyText = await earlyRes.text();
    bodies.push(earlyText);
    assert.equal(earlyRes.status, 409);
    assert.deepEqual(JSON.parse(earlyText), { error: "not_approved" });

    const failedRes = await fetch(url + "/api/orders/ORDER-REST-1/capture", { method: "POST" });
    const failedText = await failedRes.text();
    bodies.push(failedText);
    assert.equal(failedRes.status, 502);
    assert.deepEqual(JSON.parse(failedText), { error: "paypal_error" });

    const returned = await fetch(url + "/return?token=ORDER-REST-1", { redirect: "manual" });
    const location = returned.headers.get("location") || "";
    bodies.push(location);
    assert.equal(returned.status, 302);
    assert.match(location, /checkout-return\.html\?token=ORDER-REST-1$/);
    assert.equal(location.includes("mock=1"), false);

    const blob = bodies.join("\n") + "\n" + logs.join("\n");
    assert.equal(blob.includes(accessToken), false);
    assert.equal(blob.includes(secret), false);
    assert.ok(paypalUrls.length > 0);
    assert.ok(paypalUrls.every((target) => target.startsWith("https://api-m.sandbox.paypal.com")));
    assert.ok(paypalUrls.every((target) => !target.includes(secret) && !target.includes(accessToken)));
  } finally {
    console.log = original;
    await close(server);
  }
});
