import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("a parcel tracking code and a shop wifi code are silent", async () => {
  const tracking = await detect("Send me the tracking code when the parcel ships tomorrow morning.");
  assert.equal(tracking.kind, "silent");
  assert.equal(tracking.silentReason, "no_atom");
  assert.deepEqual(tracking.signals, []);
  assert.deepEqual(findAtoms("Send me the tracking code when the parcel ships tomorrow morning."), []);

  const wifi = await detect("Share the wifi code for the shop when you arrive tomorrow please.");
  assert.equal(wifi.kind, "silent");
  assert.equal(wifi.silentReason, "no_atom");
  assert.deepEqual(wifi.signals, []);
  assert.deepEqual(findAtoms("Share the wifi code for the shop when you arrive tomorrow please."), []);
});

test("an SMS code stays risk, and sort, discount, and post codes stay as they were", async () => {
  const sms = "Please send me the 6-digit code you got by SMS so I can pay.";
  const smsResult = await detect(sms);
  assert.equal(smsResult.kind, "risk");
  assert.equal(smsResult.level, "medium");
  assert.deepEqual(smsResult.signals, ["credential_request"]);
  assert.ok(findAtoms(sms).some((hit) => hit.atom === "credential_request" && hit.text === "6-digit code"));

  const sort = "Send me the sort code for the shop account.";
  const sortResult = await detect(sort);
  assert.equal(sortResult.kind, "risk");
  assert.equal(sortResult.level, "high");
  assert.deepEqual(sortResult.signals, ["off_platform", "credential_request"]);
  const sortHits = findAtoms(sort);
  assert.ok(sortHits.some((hit) => hit.atom === "off_platform" && hit.text === "sort code"));
  assert.ok(sortHits.some((hit) => hit.atom === "credential_request"));

  const discount = "Send me the discount code for the lamp when you can.";
  const discountResult = await detect(discount);
  assert.equal(discountResult.kind, "silent");
  assert.equal(discountResult.silentReason, "no_atom");
  assert.deepEqual(discountResult.signals, []);

  const post = "Send me the post code when you arrive tomorrow.";
  const postResult = await detect(post);
  assert.equal(postResult.kind, "silent");
  assert.equal(postResult.silentReason, "no_atom");
  assert.deepEqual(postResult.signals, []);
});
