// Protect agent: verdict + deal in, OrdersPort createOrder out.
// The real toolkit tool-call loop is not in this build. See docs/BACKEND-CONTRACT.md.
import { randomUUID } from "node:crypto";

function bad(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "bad_request";
  throw error;
}

export async function protectDeal(input, orders) {
  const item = String(input?.item ?? "").trim();
  const amount = typeof input?.amount === "number" ? input.amount : Number(input?.amount);
  const currency = String(input?.currency ?? "").trim().toUpperCase();
  const payeeEmail = input?.payeeEmail ? String(input.payeeEmail).trim() : "";
  if (!item) bad("item is required");
  if (!Number.isFinite(amount) || amount <= 0) bad("amount must be a positive number");
  if (!/^[A-Z]{3}$/.test(currency)) bad("currency must be a 3-letter code");
  if (payeeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payeeEmail)) bad("payeeEmail is not an email");
  const created = await orders.createOrder({
    item,
    amount,
    currency,
    payeeEmail,
    referenceId: input?.referenceId || randomUUID()
  });
  return {
    orderId: created.orderId,
    status: created.status,
    approveUrl: created.approveUrl,
    mode: orders.mode
  };
}
