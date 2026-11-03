import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertSandboxBaseUrl,
  createRestPort,
  paypalError,
  pickApproveUrl
} from "../src/paypal-rest.js";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-secret-not-real";
const ACCESS_TOKEN = "A-TEST-TOKEN";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function restEnv(extra = {}) {
  return {
    PAYPAL_CLIENT_ID: CLIENT_ID,
    PAYPAL_CLIENT_SECRET: CLIENT_SECRET,
    PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    ...extra
  };
}

function tokenResponse(expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: expiresIn }), { status: 200 });
}

function createdOrder(links) {
  return new Response(JSON.stringify({
    id: "ORDER-1",
    status: "CREATED",
    links: links === undefined ? [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" }] : links
  }), { status: 200 });
}

const bike = {
  item: "Used road bike",
  amount: 1800,
  currency: "DKK",
  payeeEmail: "jonas.holm@example.com",
  referenceId: "bike-ref-1"
};

function recorded(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body,
      signal: init.signal
    };
    calls.push(call);
    return handler(call, calls);
  };
  return { calls, fetchImpl };
}

function isToken(call) {
  return call.url.endsWith("/v1/oauth2/token");
}

function isCreate(call) {
  return call.method === "POST" && call.url.endsWith("/v2/checkout/orders");
}

test("token is fetched once and reused across two createOrder calls", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await port.createOrder(bike);
  await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(calls.filter(isToken).length, 1);
  assert.equal(calls.filter(isCreate).length, 2);
});

test("token is refetched after expires_in minus 60 seconds", async () => {
  let clock = 5_000;
  const expiresIn = 120;
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse(expiresIn);
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl, now: () => clock });
  await port.createOrder(bike);
  clock = 5_000 + (expiresIn - 60) * 1000 - 1;
  await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(calls.filter(isToken).length, 1);
  clock = 5_000 + (expiresIn - 60) * 1000;
  await port.createOrder({ ...bike, referenceId: "bike-ref-3" });
  assert.equal(calls.filter(isToken).length, 2);
});

test("a short expires_in is cached for its full life", async () => {
  let clock = 1_000;
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse(30);
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl, now: () => clock });
  await port.createOrder(bike);
  clock = 1_000 + 30 * 1000 - 1;
  await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(calls.filter(isToken).length, 1);
  clock = 1_000 + 30 * 1000;
  await port.createOrder({ ...bike, referenceId: "bike-ref-3" });
  assert.equal(calls.filter(isToken).length, 2);
});

test("a missing expires_in is cached for five minutes", async () => {
  let clock = 10_000;
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return new Response(JSON.stringify({ access_token: ACCESS_TOKEN }), { status: 200 });
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl, now: () => clock });
  await port.createOrder(bike);
  clock = 10_000 + 300 * 1000 - 1;
  await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(calls.filter(isToken).length, 1);
  clock = 10_000 + 300 * 1000;
  await port.createOrder({ ...bike, referenceId: "bike-ref-3" });
  assert.equal(calls.filter(isToken).length, 2);
});

test("concurrent createOrder calls share one in-flight token request", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let tokenCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/v1/oauth2/token")) {
      tokenCalls += 1;
      await gate;
      return tokenResponse();
    }
    return createdOrder();
  };
  const port = createRestPort(restEnv(), { fetchImpl });
  const first = port.createOrder(bike);
  const second = port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(tokenCalls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(tokenCalls, 1);
});

test("token request uses Basic auth and the client-credentials form body", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return createdOrder();
  });
  const port = createRestPort(restEnv({ PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com/" }), { fetchImpl });
  await port.createOrder(bike);
  const tokenCall = calls.find(isToken);
  const expected = "Basic " + Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET, "utf8").toString("base64");
  assert.equal(tokenCall.method, "POST");
  assert.equal(tokenCall.url, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
  assert.equal(tokenCall.headers.authorization, expected);
  assert.equal(tokenCall.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(tokenCall.body, "grant_type=client_credentials");
  assert.ok(tokenCall.signal instanceof AbortSignal);
  const createCall = calls.find(isCreate);
  assert.equal(createCall.headers.authorization, "Bearer " + ACCESS_TOKEN);
  assert.equal(createCall.headers["content-type"], "application/json");
  assert.equal(createCall.headers.prefer, "return=representation");
});

test("createOrder sends CAPTURE, payee, amount, currency, and experience context", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await port.createOrder(bike);
  const createCall = calls.find(isCreate);
  assert.equal(createCall.url, "https://api-m.sandbox.paypal.com/v2/checkout/orders");
  assert.deepEqual(JSON.parse(createCall.body), {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: "bike-ref-1",
      description: "Used road bike",
      amount: { currency_code: "DKK", value: "1800.00" },
      payee: { email_address: "jonas.holm@example.com" }
    }],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: "http://localhost:8080/demo/checkout-return.html",
          cancel_url: "http://localhost:8080/demo/checkout-return.html?cancel=1",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          brand_name: "PayBrake demo"
        }
      }
    }
  });

  await port.createOrder({ item: "y".repeat(180), amount: 45.5, currency: "usd", payeeEmail: "  ", referenceId: "no-payee" });
  const second = JSON.parse(calls.filter(isCreate)[1].body);
  assert.equal(second.purchase_units[0].payee, undefined);
  assert.equal(second.purchase_units[0].description.length, 127);
  assert.equal(second.purchase_units[0].amount.currency_code, "USD");
  assert.equal(second.purchase_units[0].amount.value, "45.50");
});

test("PayPal-Request-Id is a uuid and differs between creates", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await port.createOrder(bike);
  await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  const ids = calls.filter(isCreate).map((call) => call.headers["PayPal-Request-Id"]);
  assert.equal(ids.length, 2);
  assert.match(ids[0], UUID);
  assert.match(ids[1], UUID);
  assert.notEqual(ids[0], ids[1]);
});

test("PayPal-Request-Id repeats for the same referenceId and the same capture", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    if (call.method === "POST" && call.url.endsWith("/capture")) {
      return new Response(JSON.stringify({
        id: "ORDER-1",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-1" }] } }]
      }), { status: 201 });
    }
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await port.createOrder(bike);
  await port.createOrder(bike);
  const createIds = calls.filter(isCreate).map((call) => call.headers["PayPal-Request-Id"]);
  assert.equal(createIds[0], createIds[1]);
  assert.match(createIds[0], UUID);
  await port.captureOrder("ORDER-1");
  await port.captureOrder("ORDER-1");
  await port.captureOrder("ORDER-2");
  const captureIds = calls
    .filter((call) => call.method === "POST" && call.url.endsWith("/capture"))
    .map((call) => call.headers["PayPal-Request-Id"]);
  assert.equal(captureIds.length, 3);
  assert.equal(captureIds[0], captureIds[1]);
  assert.notEqual(captureIds[0], captureIds[2]);
  assert.notEqual(captureIds[0], createIds[0]);
  assert.match(captureIds[0], UUID);
});

test("a long or non-printable referenceId is a bounded reference_id and a stable PayPal-Request-Id", async () => {
  const item = "Vintage frame " + "x".repeat(300);
  const payeeEmail = "seller@" + "e".repeat(40) + ".example";
  const referenceId = ["h".repeat(64), item, "1800", "DKK", payeeEmail].join("\u001f");
  assert.ok(referenceId.length > 256);
  const shortRef = ["abc123", "Bike", "50", "EUR", "a@b.co"].join("\u001f");
  assert.ok(shortRef.length <= 256);

  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  const order = { item, amount: 1800, currency: "DKK", payeeEmail, referenceId };
  await port.createOrder(order);
  await port.createOrder(order);

  const creates = calls.filter(isCreate);
  const sent = JSON.parse(creates[0].body).purchase_units[0].reference_id;
  const digest = createHash("sha256").update(referenceId).digest("hex");
  assert.equal(sent, digest);
  assert.equal(JSON.parse(creates[1].body).purchase_units[0].reference_id, sent);
  assert.ok(sent.length <= 256);
  assert.match(sent, /^[\x20-\x7E]+$/);
  assert.equal(sent.includes("\u001f"), false);
  assert.equal(sent.includes(payeeEmail), false);
  assert.equal(sent.includes("Vintage frame"), false);
  assert.equal(creates[0].headers["PayPal-Request-Id"], creates[1].headers["PayPal-Request-Id"]);
  assert.match(creates[0].headers["PayPal-Request-Id"], UUID);

  await port.createOrder({ item: "Bike", amount: 50, currency: "EUR", payeeEmail: "a@b.co", referenceId: shortRef });
  const shortSent = JSON.parse(calls.filter(isCreate)[2].body).purchase_units[0].reference_id;
  assert.equal(shortSent, createHash("sha256").update(shortRef).digest("hex"));
  assert.equal(shortSent.includes("a@b.co"), false);
  assert.equal(shortSent.includes("\u001f"), false);
  assert.match(calls.filter(isCreate)[2].headers["PayPal-Request-Id"], UUID);

  const capped = "r".repeat(256);
  await port.createOrder({ ...order, referenceId: capped });
  assert.equal(JSON.parse(calls.filter(isCreate)[3].body).purchase_units[0].reference_id, capped);

  const over = "r".repeat(257);
  await port.createOrder({ ...order, referenceId: over });
  const overCall = calls.filter(isCreate)[4];
  assert.equal(JSON.parse(overCall.body).purchase_units[0].reference_id, createHash("sha256").update(over).digest("hex"));
  assert.notEqual(overCall.headers["PayPal-Request-Id"], creates[0].headers["PayPal-Request-Id"]);
});

test("approve link prefers payer-action, then approve, else null", async () => {
  const cases = [
    {
      links: [
        { rel: "approve", href: "https://www.sandbox.paypal.com/approve" },
        { rel: "payer-action", href: "https://www.sandbox.paypal.com/payer" }
      ],
      expected: "https://www.sandbox.paypal.com/payer"
    },
    {
      links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/approve" }],
      expected: "https://www.sandbox.paypal.com/approve"
    },
    {
      links: [{ rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1" }],
      expected: null
    },
    {
      links: null,
      expected: null
    }
  ];
  for (const item of cases) {
    const { fetchImpl } = recorded(async (call) => {
      if (isToken(call)) return tokenResponse();
      return createdOrder(item.links);
    });
    const port = createRestPort(restEnv(), { fetchImpl });
    const created = await port.createOrder({ item: "Lamp", amount: 45, currency: "EUR", referenceId: "lamp" });
    assert.equal(created.approveUrl, item.expected);
    assert.equal(pickApproveUrl(item.links), item.expected);
  }
});

test("getOrder returns null on 404 and parses captureId", async () => {
  const seen = [];
  const { fetchImpl } = recorded(async (call) => {
    seen.push(call.url);
    if (isToken(call)) return tokenResponse();
    if (call.url.endsWith("/v2/checkout/orders/missing")) {
      return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
    }
    if (call.url.endsWith("/v2/checkout/orders/" + encodeURIComponent("a/b"))) {
      return new Response(JSON.stringify({
        id: "a/b",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-9" }] } }],
        links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/payer" }]
      }), { status: 200 });
    }
    if (call.url.endsWith("/v2/checkout/orders/ORDER-1")) {
      return new Response(JSON.stringify({ id: "ORDER-1", status: "CREATED", purchase_units: [{}], links: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: "INTERNAL_SERVER_ERROR" }), { status: 500 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  assert.equal(await port.getOrder("missing"), null);
  const completed = await port.getOrder("a/b");
  assert.deepEqual(completed, {
    orderId: "a/b",
    status: "COMPLETED",
    captureId: "CAP-9",
    approveUrl: "https://www.sandbox.paypal.com/payer"
  });
  assert.ok(seen.some((url) => url.endsWith("/v2/checkout/orders/a%2Fb")));
  const created = await port.getOrder("ORDER-1");
  assert.equal(created.captureId, null);
  assert.equal(created.approveUrl, null);
});

test("captureOrder returns COMPLETED and the capture id", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    assert.equal(call.body, "{}");
    assert.match(call.headers["PayPal-Request-Id"], UUID);
    return new Response(JSON.stringify({
      id: "ORDER-1",
      status: "COMPLETED",
      purchase_units: [{ payments: { captures: [{ id: "CAP-DONE" }] } }]
    }), { status: 201 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  const captured = await port.captureOrder("ORDER-1");
  assert.deepEqual(captured, { orderId: "ORDER-1", status: "COMPLETED", captureId: "CAP-DONE" });
  assert.equal(calls.some((call) => call.url.endsWith("/v2/checkout/orders/ORDER-1/capture")), true);
});

test("capture 422 ORDER_NOT_APPROVED or PAYER_ACTION_REQUIRED is 409 not_approved", async () => {
  for (const issue of ["ORDER_NOT_APPROVED", "PAYER_ACTION_REQUIRED"]) {
    const { fetchImpl } = recorded(async (call) => {
      if (isToken(call)) return tokenResponse();
      return new Response(JSON.stringify({
        name: "UNPROCESSABLE_ENTITY",
        message: "payer action " + ACCESS_TOKEN,
        details: [{ issue, description: CLIENT_SECRET }]
      }), { status: 422 });
    });
    const port = createRestPort(restEnv(), { fetchImpl });
    await assert.rejects(() => port.captureOrder("ORDER-1"), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "not_approved");
      assert.equal(error.message.includes(ACCESS_TOKEN), false);
      assert.equal(error.message.includes(CLIENT_SECRET), false);
      return true;
    });
  }
});

test("capture 422 ORDER_ALREADY_CAPTURED returns the existing capture", async () => {
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    if (call.method === "POST") {
      return new Response(JSON.stringify({
        name: "UNPROCESSABLE_ENTITY",
        details: [{ issue: "ORDER_ALREADY_CAPTURED" }]
      }), { status: 422 });
    }
    return new Response(JSON.stringify({
      id: "ORDER-1",
      status: "COMPLETED",
      purchase_units: [{ payments: { captures: [{ id: "CAP-EXISTING" }] } }],
      links: []
    }), { status: 200 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  const again = await port.captureOrder("ORDER-1");
  assert.deepEqual(again, { orderId: "ORDER-1", status: "COMPLETED", captureId: "CAP-EXISTING" });
  assert.equal(calls.filter(isToken).length, 1);
  assert.equal(calls.filter((call) => call.method === "GET").length, 1);
});

test("401 on an orders call drops the token and retries once", async () => {
  let orderAttempts = 0;
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    orderAttempts += 1;
    if (orderAttempts === 1) return new Response(JSON.stringify({ name: "AUTHENTICATION_FAILURE" }), { status: 401 });
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  const created = await port.createOrder(bike);
  assert.equal(created.orderId, "ORDER-1");
  assert.equal(calls.filter(isToken).length, 2);
  assert.equal(orderAttempts, 2);
  const createCalls = calls.filter(isCreate);
  assert.equal(createCalls[0].headers["PayPal-Request-Id"], createCalls[1].headers["PayPal-Request-Id"]);
  await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(calls.filter(isToken).length, 2);
});

test("a second 401 becomes 502 paypal_auth and does not retry again", async () => {
  let orderAttempts = 0;
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    orderAttempts += 1;
    return new Response(JSON.stringify({ name: "AUTHENTICATION_FAILURE", message: ACCESS_TOKEN }), { status: 401 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await assert.rejects(() => port.createOrder(bike), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "paypal_auth");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    return true;
  });
  assert.equal(orderAttempts, 2);
  assert.equal(calls.filter(isToken).length, 2);
});

test("403 on an orders call does not refresh the token or retry", async () => {
  let orderAttempts = 0;
  const { calls, fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    orderAttempts += 1;
    if (orderAttempts === 1) return new Response(JSON.stringify({ name: "NOT_AUTHORIZED" }), { status: 403 });
    return createdOrder();
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await assert.rejects(() => port.createOrder(bike), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "paypal_auth");
    return true;
  });
  assert.equal(orderAttempts, 1);
  assert.equal(calls.filter(isToken).length, 1);
  const created = await port.createOrder({ ...bike, referenceId: "bike-ref-2" });
  assert.equal(created.orderId, "ORDER-1");
  assert.equal(orderAttempts, 2);
  assert.equal(calls.filter(isToken).length, 1);
});

test("PayPal 500 maps to 502 paypal_error", async () => {
  const { fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return new Response(JSON.stringify({
      name: "INTERNAL_SERVER_ERROR",
      message: ACCESS_TOKEN + " " + CLIENT_SECRET
    }), { status: 500 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await assert.rejects(() => port.captureOrder("ORDER-1"), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "paypal_error");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.message.includes(CLIENT_SECRET), false);
    return true;
  });
});

test("a thrown fetch maps to 502 paypal_error without the transport message", async () => {
  const { fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    throw new Error("connect refused " + ACCESS_TOKEN);
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await assert.rejects(() => port.getOrder("ORDER-1"), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "paypal_error");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.message.includes("refused"), false);
    return true;
  });
});

test("PayPal 400 INVALID_REQUEST maps to 400 bad_request", async () => {
  const { fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return new Response(JSON.stringify({
      name: "INVALID_REQUEST",
      message: "bad " + ACCESS_TOKEN,
      details: [{ issue: "INVALID_REQUEST", description: CLIENT_SECRET }]
    }), { status: 400 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  await assert.rejects(() => port.createOrder(bike), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "bad_request");
    assert.equal(error.message, "PayPal rejected the order: INVALID_REQUEST");
    assert.equal(error.message.includes(ACCESS_TOKEN), false);
    assert.equal(error.message.includes(CLIENT_SECRET), false);
    return true;
  });
});

test("paypalError keeps only PayPal name or issue constants", () => {
  const prose = paypalError(422, {
    name: "UNPROCESSABLE_ENTITY",
    message: "see " + ACCESS_TOKEN,
    details: [{ issue: "INVALID_PARAMETER_SYNTAX", description: CLIENT_SECRET }]
  });
  assert.equal(prose.status, 400);
  assert.equal(prose.code, "bad_request");
  assert.equal(prose.message, "PayPal rejected the order: INVALID_PARAMETER_SYNTAX");
  const unsafe = paypalError(400, { name: "not a constant", details: [{ issue: "bad " + ACCESS_TOKEN }] });
  assert.equal(unsafe.message, "PayPal rejected the order");
  assert.equal(unsafe.message.includes(ACCESS_TOKEN), false);
  const limited = paypalError(429, { name: "RATE_LIMIT_REACHED" });
  assert.equal(limited.status, 502);
  assert.equal(limited.code, "paypal_error");
});

test("unsupported currency GBP is 400 and fetch is never called", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("{}", { status: 500 });
  };
  const port = createRestPort(restEnv(), { fetchImpl });
  await assert.rejects(
    () => port.createOrder({ item: "Hat", amount: 12, currency: "GBP", referenceId: "hat" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "bad_request");
      assert.equal(error.message, "currency must be DKK, EUR, or USD");
      return true;
    }
  );
  assert.equal(calls, 0);
});

test("sandbox guard refuses live and non-https base URLs", () => {
  const refused = [
    "https://api-m.paypal.com",
    "https://api.paypal.com",
    "http://api-m.sandbox.paypal.com"
  ];
  for (const url of refused) {
    assert.throws(() => assertSandboxBaseUrl(url), (error) => {
      assert.equal(error.message, "Refusing non-sandbox PayPal base URL");
      assert.equal(error.message.includes("paypal.com"), false);
      return true;
    });
    assert.throws(() => createRestPort(restEnv({ PAYPAL_BASE_URL: url })), (error) => {
      assert.equal(error.message, "Refusing non-sandbox PayPal base URL");
      return true;
    });
  }
  assert.doesNotThrow(() => assertSandboxBaseUrl("https://api.sandbox.paypal.com"));
  assert.doesNotThrow(() => assertSandboxBaseUrl("https://api-m.sandbox.paypal.com"));
});

test("missing secret throws and does not echo a value", () => {
  assert.throws(
    () => createRestPort({ PAYPAL_CLIENT_ID: CLIENT_ID }),
    (error) => error.message === "PAYPAL_CLIENT_SECRET is required for the rest adapter"
  );
  assert.throws(
    () => createRestPort({ PAYPAL_CLIENT_ID: CLIENT_ID, PAYPAL_CLIENT_SECRET: "   " }),
    (error) => error.message === "PAYPAL_CLIENT_SECRET is required for the rest adapter"
  );
});

test("capture 404 returns null", async () => {
  const { fetchImpl } = recorded(async (call) => {
    if (isToken(call)) return tokenResponse();
    return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
  });
  const port = createRestPort(restEnv(), { fetchImpl });
  assert.equal(await port.captureOrder("missing"), null);
});
