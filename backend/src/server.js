// PayBrake HTTP API. Node 20, node:http, no framework.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOrdersPort } from "./paypal.js";
import { protectDeal } from "./agent.js";
import { classifyText, resolveLlm } from "./classify.js";
import { NAME } from "./brand.js";

export const BODY_LIMIT = 16 * 1024;
const DEMO_RETURN = "http://localhost:8080/demo/checkout-return.html";

export function loadEnvFile(file, env = process.env) {
  if (!file || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] == null || env[key] === "") env[key] = value;
  }
}

function bad(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "bad_request";
  throw error;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > BODY_LIMIT) {
      req.resume();
      const error = new Error("payload too large");
      error.status = 413;
      error.code = "payload_too_large";
      reject(error);
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        const error = new Error("payload too large");
        error.status = 413;
        error.code = "payload_too_large";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) bad("JSON body must be an object");
    return body;
  } catch (error) {
    if (error.status) throw error;
    bad("invalid JSON");
  }
}

function applyCors(req, res, env) {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== "string") return;
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowed.includes(origin) && !origin.startsWith("chrome-extension://")) return;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "600");
}

function send(res, status, body) {
  if (res.writableEnded || res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function logStatus(id, status) {
  if (!id || !status) return;
  console.log(`order ${id} ${status}`);
}

function publicMessage(error) {
  const message = String((error && error.message) || "");
  if (!message) return "bad_request";
  if (/authorization|bearer |access_token|client_secret/i.test(message)) return "bad_request";
  return message;
}

function fail(res, error) {
  if (error && error.status === 413) return send(res, 413, { error: "payload_too_large" });
  if (error && error.status === 404) return send(res, 404, { error: "not_found" });
  if (error && error.status === 400) return send(res, 400, { error: "bad_request", message: publicMessage(error) });
  if (error && error.status === 409) return send(res, 409, { error: error.code || "conflict" });
  if (error && (error.code === "llm_off" || error.status === 503)) return send(res, 503, { error: "llm_off" });
  if (error && error.status === 502) {
    const code = error.code === "paypal_error" || error.code === "paypal_auth" ? error.code : "llm_error";
    return send(res, 502, { error: code });
  }
  return send(res, 500, { error: "internal" });
}

export function createHandler(env = {}, deps = {}) {
  if (!env.ALLOWED_ORIGINS) {
    env = Object.assign({}, env, {
      ALLOWED_ORIGINS: "http://localhost:8080,http://127.0.0.1:8080"
    });
  }
  const orders = deps.orders || createOrdersPort(env, { fetchImpl: deps.fetchImpl, now: deps.now });
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const llm = resolveLlm(env);

  return async (req, res) => {
    applyCors(req, res, env);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    try {
      if (req.method === "GET" && pathname === "/health") {
        send(res, 200, {
          ok: true,
          name: NAME,
          env: "sandbox",
          paypal: orders.mode,
          llm: llm.configured ? "configured" : "off",
          llmProvider: llm.configured ? llm.provider : "off"
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/classify") {
        const body = await readJson(req);
        if (typeof body.text !== "string") bad("text is required");
        if (!llm.configured) {
          send(res, 503, { error: "llm_off" });
          return;
        }
        // The caller may send its rules level; the AI may lower it but never raise it.
        // "none" and any other value are not a cap: the model may still add a card.
        const rulesLevel = body.rulesLevel === "high" || body.rulesLevel === "medium" ? body.rulesLevel : "";
        const verdict = await classifyText(body.text, env, fetchImpl, rulesLevel);
        send(res, 200, verdict);
        return;
      }

      if (req.method === "POST" && pathname === "/api/protect") {
        const body = await readJson(req);
        const created = await protectDeal(body, orders);
        logStatus(created.orderId, created.status);
        send(res, 200, created);
        return;
      }

      const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)(?:\/(capture|approve-mock))?$/);
      if (orderMatch) {
        const id = decodeURIComponent(orderMatch[1]);
        const action = orderMatch[2] || "";
        if (req.method === "GET" && !action) {
          const order = await orders.getOrder(id);
          if (!order) {
            send(res, 404, { error: "not_found" });
            return;
          }
          send(res, 200, { orderId: order.orderId, status: order.status });
          return;
        }
        if (req.method === "POST" && action === "approve-mock") {
          await readJson(req);
          if (typeof orders.approve !== "function") {
            send(res, 404, { error: "not_found" });
            return;
          }
          const approved = await orders.approve(id);
          if (!approved) {
            send(res, 404, { error: "not_found" });
            return;
          }
          logStatus(approved.orderId, approved.status);
          send(res, 200, { orderId: approved.orderId, status: approved.status });
          return;
        }
        if (req.method === "POST" && action === "capture") {
          await readJson(req);
          const captured = await orders.captureOrder(id);
          if (!captured) {
            send(res, 404, { error: "not_found" });
            return;
          }
          logStatus(captured.orderId, captured.status);
          send(res, 200, captured);
          return;
        }
      }

      if (req.method === "GET" && (pathname === "/return" || pathname === "/cancel")) {
        const token = url.searchParams.get("token") || "";
        if (pathname === "/return" && token && orders.mode === "mock" && typeof orders.approve === "function") {
          const approved = await orders.approve(token);
          if (approved) logStatus(approved.orderId, approved.status);
        }
        const dest = new URL(DEMO_RETURN);
        if (token) dest.searchParams.set("token", token);
        if (orders.mode === "mock") dest.searchParams.set("mock", "1");
        if (pathname === "/cancel") dest.searchParams.set("cancel", "1");
        res.writeHead(302, { location: dest.toString() });
        res.end();
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (error) {
      fail(res, error);
    }
  };
}

export function createServer(env = {}, deps = {}) {
  return http.createServer(createHandler(env, deps));
}

export function start(env = process.env) {
  const handler = createHandler(env, {});
  const port = Number(env.PORT || 8787);
  const server = http.createServer(handler);
  server.listen(port, "127.0.0.1");
  const v6 = http.createServer(handler);
  v6.on("error", () => {});
  v6.listen(port, "::1");
  server.on("close", () => {
    try { v6.close(); } catch { /* already closed */ }
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  loadEnvFile(envFile);
  try {
    const server = start(process.env);
    server.on("listening", () => {
      const addr = server.address();
      console.log(`PayBrake backend http://127.0.0.1:${addr.port}`);
    });
  } catch (error) {
    console.error(error.message || "backend failed to start");
    process.exit(1);
  }
}
