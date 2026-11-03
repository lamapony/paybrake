import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { payRisk } from "../extension/lib/index.js";

const messages = JSON.parse(fs.readFileSync(new URL("../night/messages.json", import.meta.url)));

// Levels re-read on main after the #15–#20 detectors and the v3 atoms.
// Two or more strong atoms, or one strong atom plus a weak one, is high.
// One strong atom is medium, including a lone credential_request (standalone,
// so it does not depend on being the first entry in `strong`).
// Message 9 is the honest seller: collection is a veto, and the MobilePay
// mention is a handover, so the card stays silent.
const expected = [
  { level: "high", signals: ["friends_family", "upfront_deposit", "urgency_pressure"] },
  { level: "medium", signals: ["friends_family"] },
  { level: "high", signals: ["off_platform", "pay_before_see", "ship_before_meet"] },
  { level: "medium", signals: ["off_platform"] },
  { level: "medium", signals: ["credential_request"] },
  { level: "high", signals: ["off_platform", "phishing_link", "overpayment_refund"] },
  { level: "high", signals: ["urgency_pressure", "phishing_link", "fee_via_link"] },
  { level: "high", signals: ["upfront_deposit", "off_platform", "urgency_pressure"] },
  { level: "silent", signals: [], silentReason: "veto" }
];

test("roleplay messages have the expected rules-only levels", async () => {
  assert.equal(messages.length, expected.length);
  for (const [i, message] of messages.entries()) {
    const result = await payRisk.detect(message);
    const got = result.kind === "silent" ? "silent" : result.level;
    assert.equal(got, expected[i].level, `message ${i + 1} level`);
    assert.deepEqual(result.signals, expected[i].signals, `message ${i + 1} signals`);
    if (expected[i].silentReason) {
      assert.equal(result.silentReason, expected[i].silentReason, `message ${i + 1} reason`);
    }
  }
});
