import test from "node:test";
import assert from "node:assert/strict";
import { payRisk, redact } from "../extension/lib/index.js";

const { detect, transcriptOf } = payRisk;

const them = (text) => ({ from: "seller", text });
const me = (text) => ({ from: "buyer", text });
const ctxOf = (...messages) => ({ messages });
const textOf = (ctx) => ctx.messages.map((m) => m.text).join("\n");

async function run(ctx, ask, extra = {}) {
  return detect(textOf(ctx), ctx, { askLlm: ask, llmMode: "all", ...extra });
}

// ---- new rules ----

const RULES = [
  ["OTP request", "Hi, this is your bank. Please send me the 6-digit code we just texted you to confirm.", true, "credential_request"],
  ["MitID login", "To receive the money, log ind med MitID on this page and approve.", true, "credential_request"],
  ["AnyDesk", "Please install AnyDesk so our technician can fix your account.", true, "remote_access"],
  ["lookalike domain", "Your payment is waiting, confirm it at https://paypa1-secure.com/claim now", true, "phishing_link"],
  ["fee via link", "Your parcel is held. Pay the customs fee of 15 kr via this link: https://dhl-parcel.top/pay", true, "fee_via_link"],
  ["bare lookalike domain", "Pay with this link: paypa1-secure-checkout.example/pay", true, "phishing_link"],
  ["help-centre subdomain", "Thanks for your payment. To review billing, log into your account at support.example.com or the app.", false, null],
  ["OTP never-share notice", "Your code is 482913. Never share this code with anyone, the bank will never ask for it.", false, null],
  ["official site", "You can check the status on the official website of your bank.", false, null]
];

for (const [name, text, fires, atom] of RULES) {
  test(`rules v3: ${name}`, async () => {
    const verdict = await detect(text, ctxOf(them(text)));
    if (fires) {
      assert.equal(verdict.kind, "risk", JSON.stringify(verdict));
      assert.ok(verdict.signals.includes(atom), verdict.signals.join(","));
    } else {
      assert.equal(verdict.kind, "silent", JSON.stringify(verdict.signals));
    }
  });
}

test("speaker gate: the user's own line never raises a card", async () => {
  const ctx = ctxOf(them("Hi, is the bike still for sale?"), me("Can I pay with AnyDesk or send you my card number and the 6-digit code?"));
  const verdict = await detect(textOf(ctx), ctx);
  assert.equal(verdict.kind, "silent");
});

// ---- redaction ----

test("redact masks email, phone, IBAN, card, CPR and codes", () => {
  const out = redact.redact("Mail anna@example.com, ring +45 12 34 56 78, IBAN DK5000400440116243, card 4111 1111 1111 1111, CPR 010190-1234, code 482913");
  assert.ok(!out.includes("anna@example.com"));
  assert.ok(!out.includes("12 34 56 78"));
  assert.match(out, /IBAN ending 6243/);
  assert.ok(!out.includes("0040044011"));
  assert.match(out, /card ending 1111/);
  assert.ok(!out.includes("4111 1111"));
  assert.ok(!out.includes("010190-1234"));
  assert.ok(!out.includes("482913"));
});

test("transcript labels speakers and is redacted", () => {
  const t = transcriptOf([them("Send 200 kr to anna@example.com"), me("ok, my number is +45 12345678")]);
  assert.match(t.text, /^Them: /);
  assert.match(t.text, /\nMe: /);
  assert.ok(!t.text.includes("anna@example.com"));
  assert.ok(!t.text.includes("12345678"));
  assert.ok(!t.them.includes("Me:"));
});

// ---- combineAll ----

const PHISH = "Hello, we noticed a problem with your delivery. Please reply so we can sort it out today.";

test("AI adds a card when rules are silent", async () => {
  const ctx = ctxOf(them(PHISH));
  let seen = null;
  const verdict = await run(ctx, async (payload) => {
    seen = payload;
    return { risky: true, level: "medium", confidence: 0.8, signal: "impersonation", reason: "Looks like a fake delivery message.", evidence: ["problem with your delivery"] };
  });
  assert.equal(seen.mode, "all");
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.llm, "added");
  assert.equal(verdict.source, "ai");
  assert.deepEqual(verdict.signals, ["impersonation"]);
});

test("AI add below the confidence bar stays silent", async () => {
  const verdict = await run(ctxOf(them(PHISH)), async () => ({ risky: true, level: "medium", confidence: 0.2, signal: "other", reason: "x", evidence: ["problem with your delivery"] }));
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.llm, "agreed_silent");
});

test("AI evidence quoting only the user's line is rejected", async () => {
  const ctx = ctxOf(them(PHISH), me("Here is my card number, is that fine?"));
  const verdict = await run(ctx, async () => ({ risky: true, level: "high", confidence: 0.95, signal: "credential_request", reason: "x", evidence: ["Here is my card number"] }));
  assert.equal(verdict.kind, "silent");
});

const FF = "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow";

test("high-confidence AI downgrade silences a rules card", async () => {
  const verdict = await run(ctxOf(them(FF)), async () => ({ risky: false, level: "none", confidence: 0.95, reason: "fine", evidence: [] }));
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.llm, "downgraded");
});

test("low-confidence AI disagreement keeps the rules card", async () => {
  const verdict = await run(ctxOf(them(FF)), async () => ({ risky: false, level: "none", confidence: 0.6, reason: "fine", evidence: [] }));
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.llm, "disagreed_low_confidence");
});

test("AI timeout falls back to rules with llm unavailable", async () => {
  const verdict = await run(ctxOf(them(FF)), () => new Promise(() => {}), { timeoutMs: 50 });
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.llm, "unavailable");
});

test("server without AI (503 llm_off) reports off_server", async () => {
  const verdict = await run(ctxOf(them(PHISH)), async () => {
    const error = new Error("llm_off");
    error.code = "llm_off";
    error.status = 503;
    throw error;
  });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.llm, "off_server");
});

test("model text is redacted before it is sent", async () => {
  let sent = "";
  await run(ctxOf(them("Please pay to my IBAN DK5000400440116243 or mail anna@example.com today")), async (payload) => {
    sent = payload.text;
    return { risky: false, level: "none", confidence: 0.9, evidence: [] };
  });
  assert.ok(sent.length > 0);
  assert.ok(!sent.includes("anna@example.com"));
  assert.ok(!sent.includes("0040044011"));
});

test("AI alone does not turn a 'never share this code' notice into a card", async () => {
  const text = "Your verification code is 847291. It is valid for 10 minutes. Never share this code with anyone.";
  const verdict = await run(ctxOf(them(text)), async () => ({ risky: true, level: "high", confidence: 0.9, signal: "credential_request", reason: "x", evidence: ["Never share this code with anyone."] }));
  assert.equal(verdict.kind, "silent");
});

test("a code notice that also asks to send the code to them still gets the AI card", async () => {
  const text = "Your bank: never share this code with strangers. Our agent will call, read it to our agent to stop the transfer.";
  const verdict = await run(ctxOf(them(text)), async () => ({ risky: true, level: "high", confidence: 0.9, signal: "credential_request", reason: "x", evidence: ["read it to our agent"] }));
  assert.equal(verdict.kind, "risk");
});
