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

test("1500 NOK and 1500 SEK", () => {
  const nok = one("Send 1500 NOK upfront to hold it.");
  assert.equal(nok.value, 1500);
  assert.equal(nok.currency, "NOK");
  const sek = one("Send 1500 SEK upfront to hold it.");
  assert.equal(sek.value, 1500);
  assert.equal(sek.currency, "SEK");
});

test("kr stays DKK and a bare number or a Danish nok is not a new amount", () => {
  const kr = one("Send 1500 kr upfront to hold it.");
  assert.equal(kr.value, 1500);
  assert.equal(kr.currency, "DKK");
  assert.equal(parseAmounts("NOK is the currency code I learned in school yesterday.").length, 0);
  assert.equal(parseAmounts("Send me 500 for the bike in advance.").length, 0);
  assert.equal(parseAmounts("Send 2 photos in advance of the bike.").length, 0);
  const enough = parseAmounts("Send 1500 kr er nok upfront to hold it.");
  assert.equal(enough.length, 1);
  assert.equal(enough[0].currency, "DKK");
});

test("Danish nok before a number is not NOK, a capital NOK 1500 is", () => {
  const probably = parseAmounts("Det bliver nok 500 kr.");
  assert.equal(probably.length, 1);
  assert.equal(probably[0].value, 500);
  assert.equal(probably[0].currency, "DKK");
  assert.equal(parseAmounts("Den er nok 2 år gammel").length, 0);
  assert.equal(parseAmounts("Jeg tager nok 300 for den").length, 0);
  const code = one("Send NOK 1500 upfront to hold it.");
  assert.equal(code.value, 1500);
  assert.equal(code.currency, "NOK");
  assert.equal(one("send 1500 nok first").currency, "NOK");
  const both = parseAmounts("SEK 300 now, then 200 kr later");
  assert.deepEqual(both.map((a) => [a.value, a.currency]), [[300, "SEK"], [200, "DKK"]]);
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
