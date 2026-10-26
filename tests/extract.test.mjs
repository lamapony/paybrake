import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../extension/lib/index.js";

const { parseAmounts, extractDeal } = extract;

function one(text) {
  const amounts = parseAmounts(text);
  assert.equal(amounts.length, 1, JSON.stringify(amounts));
  return amounts[0];
}

test("500 kr", () => {
  const amount = one("The ask is 500 kr today");
  assert.equal(amount.value, 500);
  assert.equal(amount.currency, "DKK");
});

test("kr 500", () => {
  const amount = one("Please send kr 500 now");
  assert.equal(amount.value, 500);
  assert.equal(amount.currency, "DKK");
});

test("DKK 1.800", () => {
  const amount = one("Price is DKK 1.800 for the bike");
  assert.equal(amount.value, 1800);
  assert.equal(amount.currency, "DKK");
});

test("1,800 kr", () => {
  const amount = one("Listed at 1,800 kr");
  assert.equal(amount.value, 1800);
  assert.equal(amount.currency, "DKK");
});

test("€45 and 45 EUR and $120", () => {
  assert.deepEqual(one("It is €45 now").value, 45);
  assert.equal(one("It is €45 now").currency, "EUR");
  assert.equal(one("Pay 45 EUR please").value, 45);
  assert.equal(one("Pay 45 EUR please").currency, "EUR");
  assert.equal(one("Send $120 today").value, 120);
  assert.equal(one("Send $120 today").currency, "USD");
});

test("listing title and price win over the chat deposit", () => {
  const text = "Send 500 kr deposit to jonas.holm@example.com";
  const deal = extractDeal(text, {
    listingTitle: "Used road bike",
    listingPrice: "1,800 kr",
    sellerEmail: "other@example.com"
  }, [{ atom: "upfront_deposit", text: "deposit", start: text.indexOf("deposit"), end: text.indexOf("deposit") + "deposit".length }]);
  assert.equal(deal.item, "Used road bike");
  assert.equal(deal.amount, 1800);
  assert.equal(deal.currency, "DKK");
  assert.equal(deal.depositAmount, 500);
  assert.equal(deal.payeeEmail, "jonas.holm@example.com");
});

test("chat amount is used when the listing has no price", () => {
  const deal = extractDeal("Please pay €45 for the lamp", {});
  assert.equal(deal.amount, 45);
  assert.equal(deal.currency, "EUR");
  assert.equal(deal.item, null);
});
