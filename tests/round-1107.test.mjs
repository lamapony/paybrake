// Round 1107 driver: no real rows in training, threshold and gate rules, text-free output.
// Uses made-up rows only; never loads eval/real/.data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainPool, pickThreshold, selectWinner, combined, modelAdds, addable, assertTextFree, mets,
  CONFIGS, CONSTRAINTS, MARGIN, BITS, quantize, weightsJs, MAX_WEIGHTS_FILE_BYTES, exactDupIds, nearDupIds,
  shipDecision, DEV_GAIN, parseChats, structuralShortcuts
} from "../research/chat-scams/round-1107.mjs";

const chat = (t) => [{ from: "seller", text: t }];
const row = (id, dataset, label, split, t) => ({ id, dataset, label, split, messages: chat(t) });

test("training pool never contains SMS, Discord, test-split or evaluation rows", () => {
  const all = [
    row("sd:1", "scam_dialogue", "scam", "dev", "send the code now"),
    row("sd:2", "scam_dialogue", "legit", "test", "see you at noon"),
    row("sg:1", "scamguardbench", "legit", null, "lunch tomorrow"),
    row("sms:1", "sms_spam", "scam", "dev", "win a prize"),
    row("dc:1", "discord", "legit", "dev", "gg wp")
  ];
  const sample = all.filter((r) => r.split);
  const synthV2 = [{ id: "v2-1", y: 1, messages: chat("pay deposit via link") }, { id: "v2-2", y: 0, messages: chat("blocked eval text") }];
  const pool = buildTrainPool({ all, sample, seed: [], synthV1: [], synthV2, excludeKeys: new Set(["blocked eval text"]) });
  const ids = pool.map((r) => r.id);
  assert.deepEqual(ids.sort(), ["sd:1", "sg:1", "v2-1"]);
  assert.ok(pool.every((r) => r.dataset !== "sms_spam" && r.dataset !== "discord"));
});

test("frozen configs: three, fixed, bits 18", () => {
  assert.equal(CONFIGS.length, 3);
  assert.ok(Object.isFrozen(CONFIGS) && CONFIGS.every(Object.isFrozen));
  assert.deepEqual(CONFIGS.map((c) => [c.epochs, c.l2, c.legitWeight]), [[12, 1e-6, 1], [12, 1e-6, 1.5], [8, 1e-5, 1]]);
  assert.equal(BITS, 18);
  assert.equal(MARGIN, 0.02);
});

test("product gate: model adds only when rules are silent for no_atom or weak_only", () => {
  for (const rules of ["veto", "short", "no_counterparty", undefined]) {
    assert.equal(combined({ rules, p: 0.999 }, 0.6), false, String(rules));
    assert.equal(modelAdds({ rules, p: 0.999 }, 0.6), false);
  }
  assert.equal(combined({ rules: "risk", p: 0 }, 0.6), true);
  assert.equal(modelAdds({ rules: "risk", p: 1 }, 0.6), false);
  assert.ok(addable("no_atom") && addable("weak_only"));
  assert.equal(combined({ rules: "weak_only", p: 0.61 }, 0.6), true);
  assert.equal(combined({ rules: "no_atom", p: 0.59 }, 0.6), false);
});

test("threshold: Discord dev 0 extra, SMS dev <=1, synth dev <=3%, floor 0.5, +0.02 margin", () => {
  const rows = [
    { group: "discord_dev", y: 0, rules: "no_atom", p: 0.8 },
    { group: "discord_dev", y: 0, rules: "veto", p: 0.99 }, // gated by rules: does not count
    { group: "sms_dev", y: 0, rules: "weak_only", p: 0.9 },
    { group: "sms_dev", y: 0, rules: "no_atom", p: 0.7 },
    ...Array.from({ length: 100 }, (_, i) => ({ group: "synth_dev", y: 0, rules: "no_atom", p: i < 4 ? 0.85 - i * 0.01 : 0.1 })),
    { group: "synth_dev", y: 1, rules: "no_atom", p: 0.95 }
  ];
  const t = pickThreshold(rows);
  // Discord needs > 0.8; SMS allows one (0.9) so needs > 0.7; synth allows 3 of 100 so needs > 0.82.
  assert.equal(t.threshold, Math.ceil((0.82 + 1e-6 + 0.02) * 1000) / 1000);
  assert.equal(t.feasible, true);
  assert.equal(t.check.discordDevExtraFP, "0/2");
  assert.equal(t.check.smsDevExtraFP, "1/2");
  const low = ["discord_dev", "sms_dev", "synth_dev"].map((group) => ({ group, y: 0, rules: "no_atom", p: 0.1 }));
  assert.ok(pickThreshold(low).threshold >= CONSTRAINTS.minThreshold + MARGIN);
  assert.equal(pickThreshold([...low, { group: "discord_dev", y: 0, rules: "no_atom", p: 0.995 }]).feasible, false);
});

test("F3: an empty calibration group throws instead of passing vacuously", () => {
  assert.throws(() => pickThreshold([{ group: "synth_dev", y: 0, rules: "no_atom", p: 0.1 }]), /discord_dev has no legit rows/);
  assert.throws(() => pickThreshold([
    { group: "discord_dev", y: 0, rules: "no_atom", p: 0.1 }, { group: "synth_dev", y: 0, rules: "no_atom", p: 0.1 }
  ]), /sms_dev/);
});

test("F1: no ship without a dev gain, even when every final-test check passes", () => {
  const good = { discordFp: 1, realTpWin: 50, realTpBase: 40, smsFpWin: 0, smsFpBase: 0 };
  assert.equal(shipDecision({ ...good, devVerdict: DEV_GAIN }).decision, "ship");
  assert.equal(shipDecision({ ...good, devVerdict: "no_improvement_on_synth_dev" }).decision, "reject");
  assert.equal(shipDecision({ ...good, devVerdict: undefined }).decision, "reject"); // frozen by the original revision
  assert.equal(shipDecision({ ...good, devVerdict: DEV_GAIN, discordFp: 2 }).decision, "reject");
  assert.equal(shipDecision({ ...good, devVerdict: DEV_GAIN, realTpWin: 40 }).decision, "reject");
  assert.equal(shipDecision({ ...good, devVerdict: DEV_GAIN, smsFpWin: 2 }).decision, "reject");
});

test("F7: malformed JSONL reports file and line only, never the line content", () => {
  const secret = "{\"id\":\"x\",\"messages\":[{\"from\":\"them\",\"text\":\"hemmelig besked med kode 4711\"";
  try {
    parseChats("{\"id\":\"a\",\"label\":\"legit\",\"messages\":[]}\n" + secret + "\n", "holdout_v2");
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.message, "holdout_v2: invalid JSON at line 2");
    assert.ok(!/hemmelig|4711/.test(e.message + String(e.stack)));
  }
});

test("F6: validate flags labels that turn counts or the opener alone separate", () => {
  const mk = (y, n, opener = "seller") => ({ y, messages: Array.from({ length: n }, (_, i) => ({ from: i % 2 ? "buyer" : opener, text: "x" })) });
  assert.deepEqual(structuralShortcuts([mk(1, 5), mk(1, 5), mk(0, 4), mk(0, 4)]), ["turns", "themTurns"]);
  assert.deepEqual(structuralShortcuts([mk(1, 5), mk(1, 4), mk(0, 4), mk(0, 5)]), []);
  const open = (y, opener, n) => ({ y, messages: [{ from: opener, text: "x" }, ...Array.from({ length: n }, (_, i) => ({ from: i % 2 ? "seller" : "buyer", text: "x" }))] });
  assert.deepEqual(structuralShortcuts([open(1, "seller", 3), open(1, "seller", 4), open(0, "buyer", 4), open(0, "buyer", 5)]), ["opener"]);
});

test("selection uses synthetic-dev recall among feasible candidates only", () => {
  const c = (order, feasible, recall, fp) => ({ order, feasible, config: { id: "c" + order }, synthDev: { rules_or_model: { recall, fp } } });
  assert.equal(selectWinner([c(0, true, 0.6, 1), c(1, false, 0.9, 0), c(2, true, 0.7, 2)]).order, 2);
  assert.equal(selectWinner([c(0, true, 0.7, 2), c(1, true, 0.7, 1)]).order, 1);
  assert.equal(selectWinner([c(0, false, 0.9, 0)]), null);
});

test("duplicate checks find exact and near copies", () => {
  const a = [{ id: "a", messages: chat("Hej mor, mit gamle nummer er væk, send 2000 kr på MobilePay") }];
  const b = [{ messages: chat("hej mor, mit gamle nummer er væk, send 2500 kr på MobilePay!") }, { messages: chat("unrelated") }];
  assert.deepEqual(nearDupIds(a, b), ["a"]);
  assert.deepEqual(exactDupIds(a, [{ messages: chat("Hej mor, mit gamle nummer er væk, send 2000 kr på MobilePay") }]), ["a"]);
  assert.deepEqual(exactDupIds(a, b), []);
});

test("results guard rejects text and accepts metrics", () => {
  assert.ok(assertTextFree({ a: mets([{ y: 1, p: 1 }, { y: 0, p: 0 }], (r) => r.p > 0.5), rows: [{ id: "discord:12", y: 0, rules: "no_atom", p: 0.1 }] }));
  assert.throws(() => assertTextFree({ rows: [{ id: "x", text: "hi" }] }));
  assert.throws(() => assertTextFree({ rows: [{ id: "x", evidence: [] }] }));
  assert.throws(() => assertTextFree({ note: "please send me the code from your bank app now" }));
  assert.throws(() => assertTextFree({ note: "x".repeat(81) }));
});

test("int8 weights at 2^18 stay under 500 KB and load in the runtime", () => {
  const w = new Float32Array(1 << BITS);
  for (let i = 0; i < w.length; i++) w[i] = ((i * 2654435761) % 255) / 127 - 1;
  const q = quantize({ w, b: -1 });
  const js = weightsJs(q, 0.9, "probe", {});
  assert.ok(js.length < MAX_WEIGHTS_FILE_BYTES, String(js.length));
  const s = globalThis.pbScamModel.score("x", { messages: chat("hello there") }, { ...q, threshold: 0.9, version: "probe" });
  assert.ok(s && s.p >= 0 && s.p <= 1);
});
