import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "../src/server.js";
import { createOrdersPort } from "../src/paypal.js";
import { TOOLKIT_TOOLS, toolkitArgsToOrder } from "../src/paypal-toolkit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_TOKEN = "A-TEST-TOKEN";

function toolkitEnv(extra = {}) {
  return {
    PAYPAL_ENV: "sandbox",
    PAYPAL_ADAPTER: "toolkit",
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-secret-not-real",
    PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    LLM_BASE_URL: "",
    ...extra
  };
}

function recorded() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body
    };
    calls.push(call);
    if (call.url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3200 }), { status: 200 });
    }
    if (call.method === "POST" && call.url.endsWith("/v2/checkout/orders")) {
      return new Response(JSON.stringify({
        id: "ORDER-TOOL-1",
        status: "CREATED",
        links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-TOOL-1" }]
      }), { status: 200 });
    }
    if (call.method === "GET" && call.url.includes("/v2/checkout/orders/")) {
      return new Response(JSON.stringify({ id: "ORDER-TOOL-1", status: "APPROVED", links: [] }), { status: 200 });
    }
    if (call.url.endsWith("/capture")) {
      return new Response(JSON.stringify({
        id: "ORDER-TOOL-1",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAP-1" }] } }]
      }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, fetchImpl };
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

test("toolkitArgsToOrder sums item totals, shipping, and discount to 2 decimals", () => {
  assert.deepEqual(toolkitArgsToOrder({
    currencyCode: "dkk",
    items: [
      { name: "Used road bike", quantity: 1, itemCost: 1500, itemTotal: 1500 },
      { name: "Lock", quantity: 2, itemCost: 49.5 }
    ],
    shippingCost: 12.5,
    discount: 3,
    payeeEmail: "jonas.holm@example.com",
    referenceId: "bike-ref-1"
  }), {
    item: "Used road bike",
    amount: 1608.5,
    currency: "DKK",
    payeeEmail: "jonas.holm@example.com",
    referenceId: "bike-ref-1"
  });

  const preferred = toolkitArgsToOrder({
    currencyCode: "EUR",
    items: [{ name: "Lamp", quantity: 4, itemCost: 10, itemTotal: 25.126 }]
  });
  assert.equal(preferred.amount, 25.13);
  assert.equal(preferred.currency, "EUR");
  assert.equal(preferred.payeeEmail, "");
  assert.equal(preferred.referenceId, undefined);

  const zeroLine = toolkitArgsToOrder({
    currencyCode: "USD",
    items: [{ name: "Sticker", quantity: 2, itemCost: 5, itemTotal: 0 }],
    shippingCost: 1.2
  });
  assert.equal(zeroLine.amount, 1.2);

  assert.throws(
    () => toolkitArgsToOrder({ currencyCode: "USD", items: [{ name: "  ", quantity: 1, itemCost: 1 }] }),
    (error) => error.status === 400 && error.code === "bad_request"
  );
});

test("TOOLKIT_TOOLS extends create_order with payeeEmail and DKK/EUR/USD", () => {
  assert.deepEqual(TOOLKIT_TOOLS.map((tool) => tool.function.name), ["create_order", "get_order", "pay_order"]);
  const create = TOOLKIT_TOOLS[0].function;
  assert.equal(create.parameters.properties.currencyCode.enum.join(","), "DKK,EUR,USD");
  assert.equal(typeof create.parameters.properties.payeeEmail.description, "string");
  assert.match(create.description, /PayBrake extension/);
  assert.deepEqual(TOOLKIT_TOOLS[1].function.parameters.required, ["id"]);
  assert.deepEqual(TOOLKIT_TOOLS[2].function.parameters.required, ["id"]);
  assert.equal(TOOLKIT_TOOLS[2].function.name, "pay_order");
});

test("create_order via runTool posts the Orders v2 body", async () => {
  const { calls, fetchImpl } = recorded();
  const port = createOrdersPort(toolkitEnv(), { fetchImpl });
  assert.equal(port.mode, "toolkit");
  assert.equal(port.tools, TOOLKIT_TOOLS);

  const created = await port.runTool("create_order", {
    currencyCode: "DKK",
    items: [{
      name: "Used road bike",
      quantity: 1,
      itemCost: 1800,
      taxPercent: 0,
      itemTotal: 1800
    }],
    payeeEmail: "jonas.holm@example.com",
    referenceId: "bike-ref-1"
  });
  assert.equal(created.orderId, "ORDER-TOOL-1");
  assert.equal(created.status, "CREATED");
  assert.equal(created.approveUrl, "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-TOOL-1");

  const createCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/v2/checkout/orders"));
  assert.equal(createCall.url, "https://api-m.sandbox.paypal.com/v2/checkout/orders");
  assert.equal(createCall.headers.authorization, "Bearer " + ACCESS_TOKEN);
  assert.match(createCall.headers["PayPal-Request-Id"], UUID);
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

  const got = await port.runTool("get_order", { id: "ORDER-TOOL-1" });
  assert.equal(got.status, "APPROVED");
  const paid = await port.runTool("pay_order", { id: "ORDER-TOOL-1" });
  assert.equal(paid.status, "COMPLETED");
  assert.equal(paid.captureId, "CAP-1");
});

test("create_order sends a bounded reference_id when the seed is long or contains a unit separator", async () => {
  const { calls, fetchImpl } = recorded();
  const port = createOrdersPort(toolkitEnv(), { fetchImpl });
  const longItem = "Vintage frame " + "y".repeat(300);
  const longEmail = "seller@" + "e".repeat(40) + ".example";
  const longRef = ["h".repeat(64), longItem, "1800", "DKK", longEmail].join("\u001f");
  assert.ok(longRef.length > 256);
  const args = {
    currencyCode: "DKK",
    items: [{ name: longItem, quantity: 1, itemCost: 1800, taxPercent: 0, itemTotal: 1800 }],
    payeeEmail: longEmail,
    referenceId: longRef
  };
  await port.runTool("create_order", args);
  await port.runTool("create_order", args);
  const longCreates = calls.filter((call) => call.method === "POST" && call.url.endsWith("/v2/checkout/orders"));
  const longSent = JSON.parse(longCreates[0].body).purchase_units[0].reference_id;
  assert.equal(longSent, createHash("sha256").update(longRef).digest("hex"));
  assert.equal(JSON.parse(longCreates[1].body).purchase_units[0].reference_id, longSent);
  assert.ok(longSent.length <= 256);
  assert.match(longSent, /^[\x20-\x7E]+$/);
  assert.equal(longSent.includes(longEmail), false);
  assert.equal(longSent.includes("Vintage frame"), false);
  assert.equal(longSent.includes("\u001f"), false);
  assert.equal(longCreates[0].headers["PayPal-Request-Id"], longCreates[1].headers["PayPal-Request-Id"]);
  assert.match(longCreates[0].headers["PayPal-Request-Id"], UUID);
});

test("unknown tool name is 400 and does not call fetch", async () => {
  let calls = 0;
  const port = createOrdersPort(toolkitEnv(), {
    fetchImpl: async () => {
      calls += 1;
      throw new Error("fetch should not run");
    }
  });
  await assert.rejects(
    () => port.runTool("refund_order", { id: "ORDER-TOOL-1" }),
    (error) => error.status === 400 && error.code === "bad_request" && error.message === "unknown tool"
  );
  assert.equal(calls, 0);
});

test("POST /api/protect returns mode toolkit", async () => {
  const { calls, fetchImpl } = recorded();
  const { server, url } = await listen(toolkitEnv({
    ALLOWED_ORIGINS: "http://localhost:8080,http://127.0.0.1:8080"
  }), { fetchImpl });
  try {
    const res = await fetch(url + "/api/protect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item: "Used road bike",
        amount: 1800,
        currency: "dkk",
        payeeEmail: "jonas.holm@example.com",
        referenceId: "bike-ref-1",
        verdict: { level: "high", signals: ["friends_family"] }
      })
    });
    const raw = await res.text();
    assert.equal(res.status, 200);
    const body = JSON.parse(raw);
    assert.equal(body.mode, "toolkit");
    assert.equal(body.orderId, "ORDER-TOOL-1");
    assert.equal(body.status, "CREATED");
    assert.equal(body.approveUrl, "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-TOOL-1");
    assert.equal(raw.includes("test-secret-not-real"), false);
    assert.equal(raw.includes(ACCESS_TOKEN), false);

    const createCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/v2/checkout/orders"));
    const sent = JSON.parse(createCall.body);
    assert.equal(sent.intent, "CAPTURE");
    assert.equal(sent.purchase_units[0].description, "Used road bike");
    assert.equal(sent.purchase_units[0].amount.value, "1800.00");
    assert.equal(sent.purchase_units[0].amount.currency_code, "DKK");
    assert.deepEqual(sent.purchase_units[0].payee, { email_address: "jonas.holm@example.com" });
    assert.equal(sent.purchase_units[0].reference_id, "bike-ref-1");
    assert.match(createCall.headers["PayPal-Request-Id"], UUID);
    assert.ok(calls.every((call) => call.url.startsWith("https://api-m.sandbox.paypal.com")));
  } finally {
    await close(server);
  }
});
