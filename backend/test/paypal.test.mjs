import test from "node:test";
import assert from "node:assert/strict";
import { createOrdersPort, formatAmount } from "../src/paypal.js";

const sandbox = { PAYPAL_ENV: "sandbox" };

test("formatAmount uses two decimals", () => {
  assert.equal(formatAmount(1800), "1800.00");
  assert.equal(formatAmount(45.5), "45.50");
  assert.equal(formatAmount("12.345"), "12.35");
});

test("sandbox guard throws when PAYPAL_ENV is live", () => {
  assert.throws(() => createOrdersPort({ PAYPAL_ENV: "live", PAYPAL_CLIENT_ID: "" }), /PAYPAL_ENV=sandbox/);
  assert.throws(() => createOrdersPort({ PAYPAL_CLIENT_ID: "" }), /PAYPAL_ENV=sandbox/);
});

test("empty client id selects the mock adapter", () => {
  const port = createOrdersPort({ ...sandbox, PAYPAL_CLIENT_ID: "", PAYPAL_ADAPTER: "rest" });
  assert.equal(port.mode, "mock");
});

test("rest and toolkit build a port, live base URL is refused", () => {
  const rest = createOrdersPort({
    ...sandbox,
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-secret-not-real",
    PAYPAL_ADAPTER: "rest"
  });
  assert.equal(rest.mode, "rest");
  assert.equal(typeof rest.approve, "undefined");

  const implicit = createOrdersPort({
    ...sandbox,
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-secret-not-real",
    PAYPAL_ADAPTER: ""
  });
  assert.equal(implicit.mode, "rest");

  assert.throws(
    () => createOrdersPort({
      ...sandbox,
      PAYPAL_CLIENT_ID: "test-client-id",
      PAYPAL_CLIENT_SECRET: "test-secret-not-real",
      PAYPAL_ADAPTER: "rest",
      PAYPAL_BASE_URL: "https://api-m.paypal.com"
    }),
    (error) => error.message === "Refusing non-sandbox PayPal base URL"
  );
  const toolkit = createOrdersPort({
    ...sandbox,
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-secret-not-real",
    PAYPAL_ADAPTER: "toolkit"
  });
  assert.equal(toolkit.mode, "toolkit");
  assert.equal(typeof toolkit.runTool, "function");
  assert.throws(
    () => createOrdersPort({ ...sandbox, PAYPAL_CLIENT_ID: "test-client-id", PAYPAL_ADAPTER: "toolkit" }),
    /PAYPAL_CLIENT_SECRET is required/
  );
  assert.throws(
    () => createOrdersPort({ ...sandbox, PAYPAL_CLIENT_ID: "test-client-id", PAYPAL_CLIENT_SECRET: "test-secret-not-real", PAYPAL_ADAPTER: "other" }),
    /Unknown PAYPAL_ADAPTER/
  );
});

test("mock order moves CREATED to APPROVED to COMPLETED", async () => {
  const port = createOrdersPort({ ...sandbox, PAYPAL_CLIENT_ID: "" });
  const created = await port.createOrder({
    item: "Used road bike",
    amount: 1800,
    currency: "DKK",
    payeeEmail: "jonas.holm@example.com"
  });
  assert.match(created.orderId, /^MOCK-/);
  assert.equal(created.status, "CREATED");
  assert.match(created.approveUrl, /^http:\/\/localhost:8080\/demo\/checkout-return\.html\?token=MOCK-/);
  assert.match(created.approveUrl, /mock=1/);
  await assert.rejects(() => port.captureOrder(created.orderId), /not approved/);
  const approved = await port.approve(created.orderId);
  assert.equal(approved.status, "APPROVED");
  const captured = await port.captureOrder(created.orderId);
  assert.equal(captured.status, "COMPLETED");
  assert.match(captured.captureId, /^MOCK-CAP-/);
  const again = await port.captureOrder(created.orderId);
  assert.equal(again.captureId, captured.captureId);
});
