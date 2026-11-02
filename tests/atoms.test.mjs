import test from "node:test";
import assert from "node:assert/strict";
import { atoms } from "../extension/lib/index.js";

const { ATOMS, findAtoms, goodsHit } = atoms;

const CASES = {
  friends_family: {
    fire: "Please pay via Friends & Family so I can reserve it",
    miss: "My friends and family loved the lamp, truly"
  },
  upfront_deposit: {
    fire: "Send a 500 kr deposit to hold it for you",
    miss: "No deposit needed, and the bottle deposit is for the shop"
  },
  off_platform: {
    fire: "Please pay by bank transfer, 200 kr",
    miss: "The frame serial is DE89370400440532013000, check it when you visit"
  },
  pay_before_see: {
    fire: "Pay first then I send the bike to you",
    miss: "You can pay after you see the bike in person"
  },
  urgency_pressure: {
    fire: "Several people are asking, so today only",
    miss: "Several people liked the photos of the bike"
  },
  ship_before_meet: {
    fire: "I can only ship, I am abroad this week",
    miss: "I can ship or you can pick it up this weekend"
  },
  pay_on_collection: {
    fire: "Cash on pickup when you come by tomorrow",
    miss: "Pay when you have time to decide on the colour"
  }
};

for (const atom of ATOMS) {
  if (atom.id === "goods_and_services_agreed") continue;
  test(`${atom.id} fires on a concrete span`, () => {
    const hits = findAtoms(CASES[atom.id].fire);
    assert.ok(hits.some((hit) => hit.atom === atom.id), JSON.stringify(hits));
  });
  test(`${atom.id} near-miss stays quiet`, () => {
    const hits = findAtoms(CASES[atom.id].miss);
    assert.equal(hits.some((hit) => hit.atom === atom.id), false, JSON.stringify(hits));
  });
}

test("goods and services veto fires when the seller agrees", () => {
  const hit = goodsHit([
    { from: "buyer", text: "Can we use PayPal Goods & Services for the bike?" },
    { from: "seller", text: "Yes, sure, that works for me." }
  ]);
  assert.equal(hit && hit.atom, "goods_and_services_agreed");
});

test("goods and services near-miss when the seller refuses", () => {
  const hit = goodsHit([
    { from: "seller", text: "I will not use Goods & Services. My friends and family loved this lamp." }
  ]);
  assert.equal(hit, null);
});

test("when you pick a time is not pay on collection", () => {
  const text = "We can meet when you pick a time.";
  const hits = findAtoms(text);
  assert.equal(hits.some((hit) => hit.atom === "pay_on_collection"), false, JSON.stringify(hits));
});

test("when you pick it up is still pay on collection", () => {
  const text = "See you when you pick it up tomorrow.";
  const hits = findAtoms(text);
  assert.ok(hits.some((hit) => hit.atom === "pay_on_collection" && hit.text.toLowerCase() === "when you pick it up"), JSON.stringify(hits));
});

test("evidence spans are slices of the input", () => {
  const text = "Send a 500 kr deposit via PayPal Friends & Family today";
  for (const hit of findAtoms(text)) {
    assert.equal(text.slice(hit.start, hit.end), hit.text);
  }
});
