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
  verification_code: { fire: "I sent a code to your phone, please send me the code", miss: "Send me the code from the gift card" },
  suspicious_link: { fire: "Visit paypal-secure-verify.example.com/claim", miss: "Visit paypal.com for help" },
  shipping_fee: { fire: "Pay a small fee of 49 kr for the shipping label", miss: "Shipping label included at no cost" },
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

test("evidence spans are slices of the input", () => {
  const text = "Send a 500 kr deposit via PayPal Friends & Family today";
  for (const hit of findAtoms(text)) {
    assert.equal(text.slice(hit.start, hit.end), hit.text);
  }
});

const CODE_FIRES = [
  "Please send me the 6-digit code.",
  "Please send me the 6-digit code from your phone.",
  "Please send me your verification code.",
  "Before I can send the bike, please send me the 6-digit code I texted to your phone.",
  "Please send the 6-digit code to me here so I can confirm."
];

const CODE_MISSES = [
  "The headphones are ready. Send me the code for the padlock.",
  "The smartphone is ready. Send me the code for the padlock.",
  "Send me the code, the serial is 16-digit.",
  "Send me the code for the garage door. My phone is in the car so I cannot open it.",
  "Buy a gift card and send me the code. Call my phone when you have it."
];

for (const text of CODE_FIRES) {
  test(`verification_code fires: ${text}`, () => {
    const hits = findAtoms(text);
    assert.ok(hits.some((hit) => hit.atom === "verification_code"), JSON.stringify(hits));
  });
}

for (const text of CODE_MISSES) {
  test(`verification_code near-miss: ${text}`, () => {
    const hits = findAtoms(text);
    assert.equal(hits.some((hit) => hit.atom === "verification_code"), false, JSON.stringify(hits));
  });
}

const LINK_FIRES = [
  "Visit paypal-secure-verify.example.com/claim",
  "https://postnord-delivery-secure.example.com/pay"
];

const LINK_MISSES = [
  "Pay here https://secure.example.com/payment",
  "See https://insecure.example.com/pay",
  "https://redelivery.example.com/pay",
  "https://secure.example.com/payments",
  "Open https://secure.example.com/paypal today"
];

for (const text of LINK_FIRES) {
  test(`suspicious_link fires: ${text}`, () => {
    const hits = findAtoms(text);
    assert.ok(hits.some((hit) => hit.atom === "suspicious_link"), JSON.stringify(hits));
  });
}

for (const text of LINK_MISSES) {
  test(`suspicious_link near-miss: ${text}`, () => {
    const hits = findAtoms(text);
    assert.equal(hits.some((hit) => hit.atom === "suspicious_link"), false, JSON.stringify(hits));
  });
}

const FEE_FIRES = [
  "Pay a small fee of $4.99 for the shipping label.",
  "Pay a small fee of 49.50 kr for the shipping label.",
  "Pay a small fee of 4,99 kr for the shipping label."
];

for (const text of FEE_FIRES) {
  test(`shipping_fee fires: ${text}`, () => {
    const hits = findAtoms(text);
    assert.ok(hits.some((hit) => hit.atom === "shipping_fee"), JSON.stringify(hits));
  });
}

test("shipping_fee does not cross a sentence period", () => {
  const text = "Pay a small fee of 49 kr. Shipping label is extra and not included.";
  const hits = findAtoms(text);
  assert.equal(hits.some((hit) => hit.atom === "shipping_fee"), false, JSON.stringify(hits));
});
