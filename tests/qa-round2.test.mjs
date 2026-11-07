import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { payRisk, atoms, chatState } from "../extension/lib/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { detect } = payRisk;
const { sessionPatch, diskDeal } = chatState;

const TYPO = "Send 500 kr deposiit via PayPal frends and famliy now, I ship tomorrow.";
const ADVICE = "Never send a deposit via PayPal Friends & Family. Beware of scams.";
const RISK = "Send 500 kr deposit via PayPal Friends & Family to hold it, I ship tomorrow";

function countingAsk() {
  const state = { calls: 0 };
  const askLlm = async () => {
    state.calls += 1;
    return { risky: true, evidence: ["deposit"], level: "high" };
  };
  return { askLlm, state };
}

test("qa r2: typo deposiit / frends and famliy warns", async () => {
  const messages = [
    { from: "seller", text: TYPO },
    { from: "seller", text: "Hello." }
  ];
  const text = messages.map((message) => message.text).join("\n");
  const verdict = await detect(text, { messages });
  assert.equal(verdict.kind, "risk");
  assert.ok(verdict.signals.includes("friends_family"), JSON.stringify(verdict.signals));
  assert.ok(verdict.signals.includes("upfront_deposit"), JSON.stringify(verdict.signals));
  for (const span of verdict.evidence) {
    assert.equal(text.slice(span.start, span.end), span.text);
  }
  const hits = atoms.findAtoms(TYPO);
  assert.ok(hits.some((hit) => hit.atom === "friends_family" && hit.text.toLowerCase().includes("frends")));
  assert.ok(hits.some((hit) => hit.atom === "upfront_deposit" && hit.text.toLowerCase() === "deposiit"));
  const friend = await detect("Please send this lamp to my friend and family this weekend.");
  assert.equal(friend.kind, "silent");
});

test("qa r2: advice against Friends & Family stays silent", async () => {
  const { askLlm, state } = countingAsk();
  const messages = [
    { from: "seller", text: "Hello." },
    { from: "seller", text: ADVICE }
  ];
  const verdict = await detect(messages.map((message) => message.text).join("\n"), { messages }, { askLlm });
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "no_atom");
  assert.equal(state.calls, 0);

  const followed = await detect(
    "Never send a deposit via PayPal Friends & Family. You can pay cash on pickup."
  );
  assert.equal(followed.kind, "silent");

  const thenAsk = await detect("Do not use the marketplace, send 500 kr via Friends and Family now.");
  assert.equal(thenAsk.kind, "risk");
  assert.ok(thenAsk.signals.includes("friends_family"));

  const neverMind = await detect("Never mind, send 500 kr deposit via PayPal Friends and Family today.");
  assert.equal(neverMind.kind, "risk");
  assert.ok(neverMind.signals.includes("upfront_deposit"));
  assert.ok(neverMind.signals.includes("friends_family"));
});

test("qa r2: checking every chat still asks the model about a pure advice line", async () => {
  const quiet = countingAsk();
  quiet.askLlm = async () => {
    quiet.state.calls += 1;
    return { risky: false, evidence: [], level: "none", confidence: 0.95 };
  };
  const stayed = await detect(ADVICE, {}, { askLlm: quiet.askLlm, llmMode: "all" });
  assert.equal(quiet.state.calls, 1);
  assert.equal(stayed.kind, "silent");

  const added = countingAsk();
  const card = await detect(ADVICE, {}, { askLlm: added.askLlm, llmMode: "all" });
  assert.equal(added.state.calls, 1);
  assert.equal(card.kind, "risk");
  assert.ok(card.evidence.some((span) => span.text === "deposit"));
});

function loadBackground(storage) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    fetch: async () => {
      throw new Error("offline");
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            const out = {};
            if (typeof key === "string" && Object.prototype.hasOwnProperty.call(storage, key)) out[key] = storage[key];
            return out;
          },
          async set(obj) {
            Object.assign(storage, obj);
          }
        }
      },
      runtime: {
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} },
        getURL(file) { return file; }
      },
      action: { onClicked: { addListener() {} } },
      tabs: { create() { return Promise.resolve(); } }
    },
    importScripts() {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const libs = ["config.js", "brand.js", "tidy.js", "atoms.js", "extract.js", "redact.js", "pay-risk.js", "ask-llm.js", "chat-state.js"];
  for (const file of libs) {
    const source = readFileSync(path.join(root, "extension/lib", file), "utf8");
    vm.runInContext(source, sandbox, { filename: file });
  }
  const background = readFileSync(path.join(root, "extension/background.js"), "utf8");
  vm.runInContext(background, sandbox, { filename: "background.js" });
  return sandbox.pbBackground;
}

test("qa r2: stored order is returned for the same chat", async () => {
  const hash = "chat-bike";
  const other = "chat-camera";
  const storage = {
    ["pbdeal:" + hash]: {
      orderId: "MOCK-persist",
      approveUrl: "http://localhost:8080/demo/checkout-return.html?token=MOCK-persist&mock=1",
      mode: "mock",
      status: "APPROVED",
      ts: Date.now()
    }
  };
  const background = loadBackground(storage);
  const res = await background.handle({
    type: "pb:detect",
    hash,
    text: RISK,
    context: { listingTitle: "Used road bike", listingPrice: "1,800 kr" }
  });
  assert.equal(res.ok, true);
  assert.equal(res.verdict.kind, "risk");
  assert.equal(res.stored.kind, "order");
  assert.equal(res.stored.orderId, "MOCK-persist");
  assert.equal(res.stored.approved, true);
  const patch = sessionPatch(res.stored);
  assert.equal(patch.state, "created");
  assert.equal(patch.orderId, "MOCK-persist");
  assert.equal(patch.approved, true);

  const missed = await background.handle({
    type: "pb:detect",
    hash: other,
    text: RISK,
    context: {}
  });
  assert.equal(missed.stored, undefined);
  assert.equal(sessionPatch(missed.stored), null);

  const paid = sessionPatch({
    kind: "order",
    orderId: "MOCK-paid",
    approveUrl: "",
    mode: "mock",
    status: "COMPLETED",
    approved: true,
    paid: true
  });
  assert.equal(paid.state, "paid");
});

test("qa r2: pay anyway override is returned for the same chat", async () => {
  const hash = "chat-camera";
  const storage = {
    ["pbdeal:" + hash]: { override: true, ts: Date.now() }
  };
  const background = loadBackground(storage);
  const res = await background.handle({
    type: "pb:detect",
    hash,
    text: "Send 2,400 kr on MobilePay to 20 34 56 78. Bank transfer works too. Today only.",
    context: { listingTitle: "Mirrorless camera", listingPrice: "2,400 kr" }
  });
  assert.equal(res.ok, true);
  assert.equal(res.verdict.kind, "risk");
  assert.equal(res.stored.kind, "override");
  assert.equal(sessionPatch(res.stored).state, "override");
  const kept = storage["pbdeal:" + hash];
  assert.equal(kept.override, true);
  assert.equal(kept.orderId, undefined);
});

test("qa r2: a typo does not double-count an exact rail", () => {
  const exact = atoms.findAtoms("Please send 500 kr as family and friends today.");
  const family = exact.filter((hit) => hit.atom === "friends_family");
  assert.equal(family.length, 1);
  assert.match(family[0].text, /family and friends/i);

  const mixed = atoms.findAtoms("Send 500 kr deposiit via Friends and Family now.");
  assert.equal(mixed.filter((hit) => hit.atom === "upfront_deposit").length, 1);
  assert.equal(mixed.find((hit) => hit.atom === "upfront_deposit").text.toLowerCase(), "deposiit");
  assert.equal(mixed.filter((hit) => hit.atom === "friends_family").length, 1);
});

test("qa r2: advice ends before the next rail ask", async () => {
  const risks = [
    ["Don't pay through Finn, use Vipps instead", "off_platform"],
    ["Don't pay through Finn, use Swish for the 500 kr instead", "off_platform"],
    ["Avoid using Goods & Services; Friends & Family is fine", "friends_family"],
    ["Don't pay on Telegram: use Western Union for the 900 kr", "off_platform"],
    ["Never use Western Union but send 400 kr via Wise today.", "off_platform"],
    ["Aldrig betal med Wise: send 500 kr med Swish i stedet", "off_platform"],
    ["Send aldrig via Friends and Family men brug Swish 500 kr i stedet", "off_platform"]
  ];
  for (const [text, atom] of risks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text + " " + JSON.stringify(verdict));
    assert.ok(verdict.signals.includes(atom), text + " " + JSON.stringify(verdict.signals));
  }

  const wise = await detect("Never use Western Union but send 400 kr via Wise today.");
  assert.ok(wise.evidence.some((span) => /wise/i.test(span.text)));
  assert.equal(wise.evidence.some((span) => /western union/i.test(span.text)), false);

  const swish = await detect("Send aldrig via Friends and Family men brug Swish 500 kr i stedet");
  assert.ok(swish.evidence.some((span) => /swish/i.test(span.text)));
  assert.equal(swish.signals.includes("friends_family"), false);

  const pivot = await detect("Avoid using Goods & Services; Friends & Family is fine");
  assert.equal(pivot.silentReason, undefined);
  assert.ok(pivot.signals.includes("friends_family"));
  assert.equal(pivot.signals.includes("goods_and_services_agreed"), false);
});

test("qa r2: advice still covers the named object", async () => {
  const quiet = [
    "Never send 500 kr, via Friends and Family for this bike.",
    "Don't pay, through Friends and Family for the bike today.",
    "Don't pay: via Friends and Family for the bike today.",
    "Never send rather large amounts via Friends and Family for this bike.",
    "Avoid sending a deposit via PayPal Friends & Family.",
    "Never send money on Telegram.",
    "I never use Zelle. The price is 500 kr for the bike.",
    "Friends and Family is fine for a gift between relatives this weekend.",
    "You can use Vipps instead of cash when you pick it up on Saturday."
  ];
  for (const text of quiet) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "silent", text + " " + JSON.stringify(verdict));
  }
});

test("qa r2: the page record keeps the order and drops the chat", () => {
  const disk = diskDeal({
    override: false,
    orderId: "MOCK-1",
    approveUrl: "http://localhost/return",
    mode: "mock",
    status: "CREATED",
    verdict: { kind: "risk" },
    context: { listingTitle: "Bike" },
    text: "Send 500 kr via Friends and Family now please"
  });
  assert.deepEqual(disk, {
    orderId: "MOCK-1",
    approveUrl: "http://localhost/return",
    mode: "mock",
    status: "CREATED"
  });
  assert.equal(diskDeal({ text: "secret thread", verdict: { kind: "risk" } }), null);
  assert.deepEqual(diskDeal({ override: true, text: "secret thread" }), { override: true });
});
