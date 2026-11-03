// OrdersPort. Mock when there is no client id. rest calls the sandbox API.
// toolkit exposes toolkit-shaped tools and executes them through rest.
import { randomUUID } from "node:crypto";
import { createRestPort } from "./paypal-rest.js";
import { createToolkitPort } from "./paypal-toolkit.js";

const DEMO_RETURN = "http://localhost:8080/demo/checkout-return.html";

export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const error = new Error("amount must be a number");
    error.status = 400;
    error.code = "bad_request";
    throw error;
  }
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function assertSandbox(env = {}) {
  const paypalEnv = String(env.PAYPAL_ENV || "").trim().toLowerCase();
  if (paypalEnv !== "sandbox") {
    throw new Error("Refusing to start unless PAYPAL_ENV=sandbox");
  }
}

export function createMockPort() {
  const orders = new Map();
  return {
    mode: "mock",
    async createOrder({ item, amount, currency, payeeEmail, referenceId } = {}) {
      const orderId = `MOCK-${randomUUID()}`;
      const record = {
        orderId,
        status: "CREATED",
        item: String(item || ""),
        amount: formatAmount(amount),
        currency: String(currency || "").toUpperCase(),
        payeeEmail: payeeEmail ? String(payeeEmail) : "",
        referenceId: referenceId || randomUUID(),
        approveUrl: `${DEMO_RETURN}?token=${encodeURIComponent(orderId)}&mock=1`,
        captureId: null
      };
      orders.set(orderId, record);
      return { orderId: record.orderId, status: record.status, approveUrl: record.approveUrl };
    },
    async getOrder(id) {
      const record = orders.get(id);
      if (!record) return null;
      return {
        orderId: record.orderId,
        status: record.status,
        captureId: record.captureId,
        approveUrl: record.approveUrl
      };
    },
    async approve(id) {
      const record = orders.get(id);
      if (!record) return null;
      if (record.status === "CREATED") record.status = "APPROVED";
      return { orderId: record.orderId, status: record.status };
    },
    async captureOrder(id) {
      const record = orders.get(id);
      if (!record) return null;
      if (record.status === "CREATED") {
        const error = new Error("Order is not approved");
        error.status = 409;
        error.code = "not_approved";
        throw error;
      }
      if (record.status !== "COMPLETED") {
        record.status = "COMPLETED";
        record.captureId = `MOCK-CAP-${randomUUID()}`;
      }
      return { orderId: record.orderId, status: record.status, captureId: record.captureId };
    }
  };
}

export function createOrdersPort(env = {}, deps = {}) {
  assertSandbox(env);
  const adapter = String(env.PAYPAL_ADAPTER || "").trim().toLowerCase();
  const hasId = String(env.PAYPAL_CLIENT_ID || "").trim().length > 0;
  if (!hasId || adapter === "mock") return createMockPort();
  if (adapter === "toolkit") return createToolkitPort(env, deps);
  if (adapter === "rest" || adapter === "") return createRestPort(env, deps);
  throw new Error("Unknown PAYPAL_ADAPTER");
}
