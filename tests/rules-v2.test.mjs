import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const ids = (text) => atoms.findAtoms(text).map((hit) => hit.atom);

test("rules v2: gift card offered as a prize is not a payment method", () => {
  assert.ok(!ids("Congratulations, you've been selected to receive a free $500 gift card.").includes("off_platform"));
  assert.ok(!ids("You won a $100 Amazon gift card, claim it today").includes("off_platform"));
});

test("rules v2: paying with a gift or store card still fires", async () => {
  assert.ok(ids("Buy a $100 Steam card and send me the code").includes("off_platform"));
  const v = await payRisk.detect("Please pay the $200 with Google Play cards and send me the codes", {});
  assert.equal(v.kind, "risk");
});

test("rules v2: the reader's own account number on a bill is not a payee", () => {
  assert.ok(!ids("Your account number: WC-789456. Amount due: $47.32, pay online").includes("off_platform"));
  assert.ok(ids("Send the £150 to account number 12345678, sort code 00-00-00").includes("off_platform"));
});

test("rules v2: Zelle / Cash App / Venmo / Western Union count as off-platform", () => {
  for (const t of ["Pay me on Zelle, $300", "send it by Cash App", "Venmo me the deposit", "Western Union the money to my cousin"]) {
    assert.ok(ids(t).includes("off_platform"), t);
  }
  assert.ok(!ids("No Venmo please, checkout is fine").includes("off_platform"));
});

test("rules v2: pound amounts are parsed", () => {
  assert.equal(globalThis.pbExtract.parseAmounts("send £150 now")[0].currency, "GBP");
});

test("rules v2: spaced IBAN and 'secure account' redirects fire, plain IDs do not", () => {
  assert.ok(ids("Please transfer the 800 EUR to DE89 3704 0044 0532 0130 00 today").includes("off_platform"));
  assert.ok(ids("Send a verification payment of £45 to our secure account now").includes("off_platform"));
  assert.ok(!ids("Order DE12 ABCD 1234 5678 shipped, tracking in the app").includes("off_platform"));
});
