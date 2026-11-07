import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

// Issue #22: a rail that opens its clause and is closed by "now"/"first" is a pay-now ask,
// even when a handover comes later in the sentence.
test("seller asks for the rail payment now, before the handover", async () => {
  const asks = [
    "Zelle now, when you collect it's yours.",
    "Venmo first, then you pick it up.",
    "Zelle me now then pick it up.",
    "Venmo me now, we can meet tomorrow."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.ok(verdict.signals.includes("off_platform"), text);
  }
});

// Genuine pay-at-handover and non-asks must stay silent.
test("pay at the handover, a refusal, a question, or product news stay silent", async () => {
  const quiet = [
    "I'll Venmo you when we meet.",
    "Do you take Venmo? I can pay when we meet.",
    "No Venmo, cash when we meet.",
    "I don't use Zelle, cash only when we meet.",
    "Venmo first? No, cash when you pick it up.",
    "Venmo now supports purchase protection.",
    "Zelle now, or cash when we meet, whatever you like.",
    "Venmo is fine when we meet."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
  }
});

// Known limitation, kept on purpose: "When we meet, Venmo me now and I'll hand it over."
// reads as paying at the meeting, so the handover still quiets the rail.
test("pay-now said at the meeting stays quiet (known limitation)", async () => {
  const verdict = await detect("When we meet, Venmo me now and I'll hand it over.");
  assert.equal(verdict.kind, "silent");
});
