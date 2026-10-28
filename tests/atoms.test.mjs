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
  credential_request: {
    fire: "Please send me the 6-digit code you got by SMS so I can pay",
    miss: "Your login code is 847291. Never share this code with anyone."
  },
  remote_access: {
    fire: "Download AnyDesk so I can check the payment on your phone",
    miss: "I would never install a remote access tool for a stranger"
  },
  phishing_link: {
    fire: "Confirm your details here to receive the payment: https://dba-secure-pay.xyz/claim",
    miss: "Photos of the bike are on https://github.com/example/bike"
  },
  fee_via_link: {
    fire: "Your parcel is held, the customs fee of 4.99 EUR must be paid here: https://post-customs.example.invalid/pay",
    miss: "The shipping cost is included in the price"
  },
  impersonation: {
    fire: "Hello, this is your bank fraud department calling about your card",
    miss: "My bank is closed on Sundays so I will pay you cash"
  },
  account_threat: {
    fire: "Your account will be suspended within 24 hours",
    miss: "My account on the forum is old but I still use it"
  },
  overpayment_refund: {
    fire: "I paid you 3,000 kr by mistake, please refund the extra 500 kr",
    miss: "I will refund your deposit if the bike is not as described"
  },
  pay_on_collection: {
    fire: "Cash on pickup when you come by tomorrow",
    miss: "Pay when you have time to decide on the colour"
  }
};

for (const atom of ATOMS) {
  if (atom.id === "goods_and_services_agreed" || atom.role === "ai") continue;
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

test("evidence spans are slices of the input", () => {
  const text = "Send a 500 kr deposit via PayPal Friends & Family today";
  for (const hit of findAtoms(text)) {
    assert.equal(text.slice(hit.start, hit.end), hit.text);
  }
});
