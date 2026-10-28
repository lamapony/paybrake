import test from "node:test";
import assert from "node:assert/strict";
import { askLlmClient, payRisk } from "../extension/lib/index.js";

function okFetch(capture) {
  return async (url, init) => {
    capture.url = url;
    capture.body = JSON.parse(init.body);
    return { ok: true, status: 200, async json() { return { risky: false, level: "none", evidence: [] }; } };
  };
}

test("askLlm sends the rules level so the server can cap the AI level", async () => {
  const capture = {};
  await askLlmClient.askLlm({ text: "some chat", level: "medium" }, { baseUrl: "http://backend.test", fetchImpl: okFetch(capture) });
  assert.equal(capture.url, "http://backend.test/api/classify");
  assert.equal(capture.body.text, "some chat");
  assert.equal(capture.body.rulesLevel, "medium");
});

test("askLlm omits rulesLevel when there is no rules level", async () => {
  const capture = {};
  await askLlmClient.askLlm({ text: "some chat" }, { baseUrl: "http://backend.test", fetchImpl: okFetch(capture) });
  assert.equal("rulesLevel" in capture.body, false);
});

test("isPaymentRisk: a payment ask gets the PayPal action, a code ask does not", () => {
  assert.equal(payRisk.isPaymentRisk({ kind: "risk", level: "high", signals: ["off_platform"], deal: {} }), true);
  assert.equal(payRisk.isPaymentRisk({ kind: "risk", level: "medium", signals: ["credential_request"], deal: { amount: 2500, currency: "DKK" } }), false);
  assert.equal(payRisk.isPaymentRisk({
    kind: "risk",
    level: "medium",
    signals: ["credential_request", "off_platform"],
    rulesSignals: ["credential_request"],
    deal: { amount: 2500, currency: "DKK" }
  }), false);
  assert.equal(payRisk.isPaymentRisk({ kind: "risk", level: "medium", signals: ["remote_access"], deal: {} }), false);
  assert.equal(payRisk.isPaymentRisk({ kind: "risk", level: "medium", signals: ["other"], deal: { amount: 2500, currency: "DKK" } }), true);
  assert.equal(payRisk.isPaymentRisk({ kind: "silent" }), false);
});
