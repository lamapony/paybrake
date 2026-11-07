import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

// Issue #21: a bare number followed by a preposition is money, not a count.
test("a bare number before for/to/via/before/then is an upfront ask", async () => {
  const asks = [
    "Send me 500 for the bike in advance, then I ship.",
    "Send 500 via Vipps upfront and I hold it.",
    "Send 500 to my PayPal in advance please.",
    "Transfer 300 to my account in advance and I ship.",
    "Send 500 before I ship upfront.",
    "Send 300, then I ship upfront.",
    "Send me 2 thousand upfront."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.ok(verdict.signals.includes("upfront_deposit"), text);
  }
});

test("a number followed by a noun, and paid history, stay silent", async () => {
  const quiet = [
    "Send me 2 photos in advance.",
    "Send 3 pictures first please.",
    "I can send 2 more photos before I ship.",
    "Send 500 photos to my email in advance",
    "I paid upfront for the service.",
    "We paid for the repair upfront.",
    "I paid for the service upfront."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
  }
});
