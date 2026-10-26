// Sandbox Orders v2 port. Callers inject fetchImpl so tests stay offline.
import { randomUUID } from "node:crypto";
import { formatAmount } from "./paypal.js";

const DEFAULT_BASE = "https://api-m.sandbox.paypal.com";
const DEFAULT_RETURN = "http://localhost:8080/demo/checkout-return.html";
const SANDBOX_HOSTS = new Set(["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"]);
const CURRENCIES = new Set(["DKK", "EUR", "USD"]);
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;

export function assertSandboxBaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing non-sandbox PayPal base URL");
  }
  if (parsed.protocol !== "https:" || !SANDBOX_HOSTS.has(parsed.hostname)) {
    throw new Error("Refusing non-sandbox PayPal base URL");
  }
}

export function pickApproveUrl(links) {
  if (!Array.isArray(links)) return null;
  const payer = links.find((link) => link && link.rel === "payer-action" && link.href);
  if (payer) return payer.href;
  const approve = links.find((link) => link && link.rel === "approve" && link.href);
  return approve ? approve.href : null;
}

function constantOf(value) {
  return typeof value === "string" && CONSTANT.test(value) ? value : "";
}

function issueList(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.details)) return [];
  return body.details.map((detail) => constantOf(detail && detail.issue)).filter(Boolean);
}

export function paypalError(status, body) {
  const label = issueList(body)[0] || constantOf(body && body.name);
  if (status === 400 || status === 422) {
    const error = new Error(label ? `PayPal rejected the order: ${label}` : "PayPal rejected the order");
    error.status = 400;
    error.code = "bad_request";
    return error;
  }
  if (status === 401 || status === 403) {
    const error = new Error("PayPal authorization failed");
    error.status = 502;
    error.code = "paypal_auth";
    return error;
  }
  const error = new Error("PayPal request failed");
  error.status = 502;
  error.code = "paypal_error";
  return error;
}

function notApproved() {
  const error = new Error("Order is not approved");
  error.status = 409;
  error.code = "not_approved";
  return error;
}

function captureIdFrom(body) {
  const id = body && body.purchase_units && body.purchase_units[0]
    && body.purchase_units[0].payments
    && body.purchase_units[0].payments.captures
    && body.purchase_units[0].payments.captures[0]
    && body.purchase_units[0].payments.captures[0].id;
  return typeof id === "string" && id ? id : null;
}

function normalizeBase(env) {
  const raw = String(env.PAYPAL_BASE_URL ?? "").trim() || DEFAULT_BASE;
  const stripped = raw.replace(/\/+$/, "");
  assertSandboxBaseUrl(stripped);
  const parsed = new URL(stripped);
  const path = parsed.pathname.replace(/\/+$/, "");
  return parsed.origin + (path === "/" ? "" : path);
}

async function readJson(res) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createRestPort(env = {}, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const base = normalizeBase(env);
  const clientId = String(env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET ?? "").trim();
  if (!clientId) throw new Error("PAYPAL_CLIENT_ID is required for the rest adapter");
  if (!clientSecret) throw new Error("PAYPAL_CLIENT_SECRET is required for the rest adapter");

  const returnUrl = String(env.PAYPAL_RETURN_URL ?? "").trim() || DEFAULT_RETURN;
  const cancelUrl = String(env.PAYPAL_CANCEL_URL ?? "").trim() || `${DEFAULT_RETURN}?cancel=1`;
  const timeoutMs = () => {
    const configured = Number(env.PAYPAL_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : 10000;
  };

  let cached = null;
  let inflight = null;

  async function requestToken() {
    let res;
    try {
      res = await fetchImpl(base + "/v1/oauth2/token", {
        method: "POST",
        headers: {
          authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64"),
          "content-type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(timeoutMs())
      });
    } catch {
      throw paypalError(502, null);
    }
    const body = await readJson(res);
    if (!res.ok) throw paypalError(res.status, body);
    if (!body || typeof body.access_token !== "string" || !body.access_token) throw paypalError(502, null);
    return body;
  }

  function getToken() {
    if (cached && now() < cached.expiresAt) return Promise.resolve(cached.token);
    if (!inflight) {
      inflight = requestToken()
        .then((body) => {
          const expiresIn = Number(body.expires_in);
          const skew = Number.isFinite(expiresIn) ? expiresIn : 0;
          cached = {
            token: body.access_token,
            expiresAt: now() + (skew - 60) * 1000
          };
          return cached.token;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  async function paypalRequest(method, path, { json, requestId, prefer } = {}) {
    let refreshed = false;
    for (;;) {
      const token = await getToken();
      const headers = { authorization: `Bearer ${token}` };
      if (json !== undefined) headers["content-type"] = "application/json";
      if (requestId) headers["PayPal-Request-Id"] = requestId;
      if (prefer) headers.prefer = prefer;
      let res;
      try {
        res = await fetchImpl(base + path, {
          method,
          headers,
          body: json === undefined ? undefined : JSON.stringify(json),
          signal: AbortSignal.timeout(timeoutMs())
        });
      } catch {
        throw paypalError(502, null);
      }
      if ((res.status === 401 || res.status === 403) && !refreshed) {
        try { await res.text(); } catch { /* discard body */ }
        cached = null;
        refreshed = true;
        continue;
      }
      const body = await readJson(res);
      return { status: res.status, body };
    }
  }

  function mapFailure(status, body) {
    const issues = issueList(body);
    if (status === 422 && (issues.includes("ORDER_NOT_APPROVED") || issues.includes("PAYER_ACTION_REQUIRED"))) {
      return notApproved();
    }
    return paypalError(status, body);
  }

  async function createOrder({ item, amount, currency, payeeEmail, referenceId } = {}) {
    const code = String(currency ?? "").trim().toUpperCase();
    if (!CURRENCIES.has(code)) {
      const error = new Error("currency must be DKK, EUR, or USD");
      error.status = 400;
      error.code = "bad_request";
      throw error;
    }
    const value = formatAmount(amount);
    const unit = {
      reference_id: referenceId ? String(referenceId) : randomUUID(),
      description: String(item ?? "").slice(0, 127),
      amount: { currency_code: code, value }
    };
    const email = payeeEmail ? String(payeeEmail).trim() : "";
    if (email) unit.payee = { email_address: email };
    const requestId = randomUUID();
    const { status, body } = await paypalRequest("POST", "/v2/checkout/orders", {
      json: {
        intent: "CAPTURE",
        purchase_units: [unit],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: returnUrl,
              cancel_url: cancelUrl,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              brand_name: "PayBrake demo"
            }
          }
        }
      },
      requestId,
      prefer: "return=representation"
    });
    if (status < 200 || status >= 300) throw mapFailure(status, body);
    return {
      orderId: body && body.id,
      status: body && body.status,
      approveUrl: pickApproveUrl(body && body.links)
    };
  }

  async function getOrder(id) {
    const { status, body } = await paypalRequest("GET", "/v2/checkout/orders/" + encodeURIComponent(id));
    if (status === 404) return null;
    if (status < 200 || status >= 300) throw mapFailure(status, body);
    return {
      orderId: body && body.id,
      status: body && body.status,
      captureId: captureIdFrom(body),
      approveUrl: pickApproveUrl(body && body.links)
    };
  }

  async function captureOrder(id) {
    const requestId = randomUUID();
    const path = "/v2/checkout/orders/" + encodeURIComponent(id) + "/capture";
    const { status, body } = await paypalRequest("POST", path, { json: {}, requestId });
    if (status === 404) return null;
    const issues = issueList(body);
    if (status === 422 && (issues.includes("ORDER_NOT_APPROVED") || issues.includes("PAYER_ACTION_REQUIRED"))) {
      throw notApproved();
    }
    if (status === 422 && issues.includes("ORDER_ALREADY_CAPTURED")) {
      const existing = await getOrder(id);
      if (!existing) return null;
      return { orderId: existing.orderId, status: existing.status, captureId: existing.captureId };
    }
    if (status < 200 || status >= 300) throw mapFailure(status, body);
    return {
      orderId: body && body.id,
      status: body && body.status,
      captureId: captureIdFrom(body)
    };
  }

  return { mode: "rest", createOrder, getOrder, captureOrder };
}
