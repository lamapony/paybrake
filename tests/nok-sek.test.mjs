import test from "node:test";
import assert from "node:assert/strict";
import { payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;

test("NOK and SEK upfront asks carry their own currency", async () => {
  const nok = await detect("Send 1500 NOK upfront to hold it.");
  assert.equal(nok.kind, "risk");
  assert.equal(nok.level, "medium");
  assert.deepEqual(nok.signals, ["upfront_deposit"]);
  assert.equal(nok.deal.amount, 1500);
  assert.equal(nok.deal.currency, "NOK");

  const sek = await detect("Send 1500 SEK upfront to hold it.");
  assert.equal(sek.kind, "risk");
  assert.equal(sek.level, "medium");
  assert.deepEqual(sek.signals, ["upfront_deposit"]);
  assert.equal(sek.deal.amount, 1500);
  assert.equal(sek.deal.currency, "SEK");

  const kr = await detect("Send 1500 kr upfront to hold it.");
  assert.equal(kr.kind, "risk");
  assert.equal(kr.level, "medium");
  assert.deepEqual(kr.signals, ["upfront_deposit"]);
  assert.equal(kr.deal.amount, 1500);
  assert.equal(kr.deal.currency, "DKK");
});

test("a currency-code lesson, photos, and a bare 500 price stay silent", async () => {
  const quiet = [
    "NOK is the currency code I learned in school yesterday.",
    "Send 2 photos in advance of the bike.",
    "Price is 500 for the bike."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text);
    assert.equal(verdict.silentReason, "no_atom", text);
    assert.deepEqual(verdict.signals, [], text);
  }
});

// A bare number is still not read as an amount in a currency, but since issue #21 asking for
// it in advance is an upfront ask (tests/issue21-bare-number.test.mjs).
test("a bare 500 asked for in advance is an upfront ask with no currency guessed", async () => {
  const verdict = await detect("Send me 500 for the bike in advance.");
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["upfront_deposit"]);
  assert.equal(verdict.deal.amount, null);
  assert.equal(verdict.deal.currency, null);
});
