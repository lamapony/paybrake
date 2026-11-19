import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("som en gave with an amount and PayPal is friends and family", async () => {
  const text = "Send pengene som en gave på PayPal, 700 kr.";
  const verdict = await detect(text);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["friends_family"]);
  assert.equal(verdict.deal.amount, 700);
  assert.equal(verdict.deal.currency, "DKK");
  assert.equal(verdict.rulesVersion, 5);
  assert.ok(findAtoms(text).some((hit) => hit.atom === "friends_family" && hit.gate === "gift-ask" && /som en gave/i.test(hit.text)));
  assert.equal(findAtoms(text).some((hit) => hit.atom === "off_platform"), false);
});

test("som gave with an amount is still friends and family", async () => {
  const paypal = "Send pengene som gave på PayPal, 700 kr.";
  const sent = await detect(paypal);
  assert.equal(sent.kind, "risk");
  assert.equal(sent.level, "medium");
  assert.deepEqual(sent.signals, ["friends_family"]);
  assert.equal(sent.deal.amount, 700);
  assert.ok(findAtoms(paypal).some((hit) => hit.atom === "friends_family" && /som gave/i.test(hit.text) && !/en gave/i.test(hit.text)));

  const overfoer = "Overfør 500 kr som gave, jeg sender i morgen.";
  const moved = await detect(overfoer);
  assert.equal(moved.kind, "risk");
  assert.equal(moved.level, "medium");
  assert.deepEqual(moved.signals, ["friends_family"]);
  assert.equal(moved.deal.amount, 500);

  const withEn = "Overfør 500 kr som en gave, jeg sender i morgen.";
  const article = await detect(withEn);
  assert.equal(article.kind, "risk");
  assert.equal(article.level, "medium");
  assert.deepEqual(article.signals, ["friends_family"]);
  assert.equal(article.deal.amount, 500);
  assert.ok(findAtoms(withEn).some((hit) => hit.atom === "friends_family" && /som en gave/i.test(hit.text)));
});

test("overfør billederne som gave without an amount stays silent", async () => {
  for (const text of [
    "overfør billederne som gave",
    "Overfør billederne som gave til museet i næste uge.",
    "overfør billederne som en gave"
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
    assert.deepEqual(verdict.evidence, [], text);
    assert.equal(findAtoms(text).some((hit) => hit.atom === "friends_family"), false, text);
  }
});

test("gavekort and familieoverførsel stay on their own rails", async () => {
  const card = await detect("Send 500 kr som en gavekort på mail i dag tak.");
  assert.equal(card.kind, "risk");
  assert.equal(card.level, "medium");
  assert.deepEqual(card.signals, ["off_platform"]);
  assert.equal(findAtoms("Send 500 kr som en gavekort på mail i dag tak.").some((hit) => hit.atom === "friends_family"), false);

  for (const text of [
    "Send 500 kr som en familieoverførsel, jeg sender i morgen.",
    "Overfør 500 kr som en familieoverførsel, så holder jeg den."
  ]) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.equal(findAtoms(text).some((hit) => hit.atom === "friends_family"), false, text);
  }

  const family = await detect("Send 500 kr som familieoverførsel, jeg sender i morgen.");
  assert.equal(family.kind, "risk");
  assert.deepEqual(family.signals, ["friends_family"]);
  assert.equal(family.deal.amount, 500);
});
