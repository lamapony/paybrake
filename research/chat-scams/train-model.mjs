// Train PayBrake's on-device chat-scam model and measure it on held-out rows.
//
//   npm run eval:real:download          # once: pinned public datasets -> eval/real/.data/ (gitignored)
//   node research/chat-scams/train-model.mjs            # train, pick threshold, report, write weights
//   node research/chat-scams/train-model.mjs --no-write # report only
//
// Featurizer: extension/lib/scam-model.js (the same file the extension runs).
// Training text: only synthetic, redistributable rows, never the test split:
//   - BothBosu/scam-dialogue (Apache-2.0, synthetic phone dialogues): every row not in the test split
//   - flowxai/scamguardbench EN (Apache-2.0, mostly synthetic): every row not in the test split
//   - data/chat-scams/seed.jsonl (ours, synthetic, Danish + English)
// Real SMS (UCI) and real Discord rows are never trained on. Their dev split is used only to
// pick the threshold (labels, no text in the weights); their test split is a transfer check.
// eval/cases/pay-risk.json (35 marketplace chats) is never trained on: it is a second held-out set.
//
// Writes extension/lib/scam-model-weights.js and research/chat-scams/model-results.json
// (metrics and per-row ids/probabilities, no message text).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../extension/lib/scam-model.js";
import { payRisk, atoms } from "../../extension/lib/index.js";
import { loadAll } from "../../eval/real/load.mjs";
import { sampleBalanced, mulberry32, shuffle } from "../../eval/real/sample.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const M = globalThis.pbScamModel;
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const BITS = Number(opt("bits", 18));
const EPOCHS = Number(opt("epochs", 12));
const L2 = Number(opt("l2", 1e-6));
const LR = Number(opt("lr", 0.5));
const FPR_BUDGET = Number(opt("fpr", 0.005));
const SEED = 20261026;
const TRAIN_SETS = new Set(["scam_dialogue", "scamguardbench"]);

const keyOf = (messages) => messages.map((m) => m.text).join("\n").trim().toLowerCase();

// ---------- data ----------
const all = loadAll();
const sample = sampleBalanced(all, { seed: SEED, cap: 500 });
const testKeys = new Set(sample.filter((r) => r.split === "test").map((r) => keyOf(r.messages)));
const sampledIds = new Map(sample.map((r) => [r.id, r.split]));

const train = [];
const seenTrain = new Set();
for (const r of all) {
  if (!TRAIN_SETS.has(r.dataset)) continue;
  if (sampledIds.get(r.id) === "test") continue;
  const k = keyOf(r.messages);
  if (!k || testKeys.has(k) || seenTrain.has(k)) continue;
  seenTrain.add(k);
  train.push({ id: r.id, dataset: r.dataset, y: r.label === "scam" ? 1 : 0, messages: r.messages });
}
const seed = readFileSync(path.join(root, "data/chat-scams/seed.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
for (const s of seed) {
  train.push({
    id: s.id,
    dataset: "seed",
    lang: s.lang,
    y: s.label === "scam" ? 1 : 0,
    messages: s.messages.map((m) => ({ from: m.speaker === "user" ? "buyer" : "seller", text: m.text }))
  });
}

// Synthetic chats in {from:"them"|"me"} form (written by a separate author for training,
// and another for held-out). Missing files are skipped.
function readChats(rel) {
  const file = path.join(root, rel);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).map((c) => ({
    id: c.id,
    lang: c.lang,
    y: c.label === "scam" ? 1 : 0,
    messages: c.messages.map((m) => ({ from: m.from === "me" ? "buyer" : "seller", text: String(m.text) }))
  }));
}
const heldout = readChats("data/chat-scams/heldout.jsonl");
const heldKeys = new Set(heldout.map((r) => keyOf(r.messages)));
if (!argv.includes("--no-synth")) {
  for (const r of readChats("data/chat-scams/train-synth.jsonl")) {
    const k = keyOf(r.messages);
    if (heldKeys.has(k) || seenTrain.has(k)) continue;
    seenTrain.add(k);
    train.push({ ...r, dataset: "train_synth" });
  }
}

const cases = JSON.parse(readFileSync(path.join(root, "eval/cases/pay-risk.json"), "utf8")).cases;

// ---------- model ----------
function feats(messages) {
  return M.featurize(M.counterpartyText(messages), BITS);
}

// Logistic regression, AdaGrad, class-balanced, L2 applied lazily on touched weights.
function fit(rows, { epochs = EPOCHS, seedRand = 1105 } = {}) {
  const n = 1 << BITS;
  const w = new Float32Array(n);
  const g2 = new Float32Array(n).fill(1e-8);
  let b = 0;
  let gb2 = 1e-8;
  const pos = rows.filter((r) => r.y === 1).length;
  const neg = rows.length - pos;
  const wPos = rows.length / (2 * Math.max(1, pos));
  const wNeg = rows.length / (2 * Math.max(1, neg));
  const X = rows.map((r) => r.x || (r.x = feats(r.messages)));
  const rand = mulberry32(seedRand);
  let order = rows.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    order = shuffle(order, rand);
    for (const i of order) {
      const { idx, val } = X[i];
      let z = b;
      for (let j = 0; j < idx.length; j++) z += w[idx[j]] * val[j];
      const p = M.sigmoid(z);
      const cw = rows[i].y ? wPos : wNeg;
      const err = (p - rows[i].y) * cw;
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j];
        const g = err * val[j] + L2 * w[k];
        g2[k] += g * g;
        w[k] -= (LR / Math.sqrt(g2[k])) * g;
      }
      gb2 += err * err;
      b -= (LR / Math.sqrt(gb2)) * err;
    }
  }
  return { w, b };
}

function predict(model, messages) {
  const { idx, val } = feats(messages);
  let z = model.b;
  for (let j = 0; j < idx.length; j++) z += model.w[idx[j]] * val[j];
  return M.sigmoid(z);
}

// Quantize to int8 with one scale, then score exactly as the browser will.
function quantize(model) {
  let max = 0;
  for (const v of model.w) max = Math.max(max, Math.abs(v));
  const scale = max / 127 || 1;
  const q = new Int8Array(model.w.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(model.w[i] / scale)));
  return { q, scale, bias: model.b };
}

// ---------- metrics ----------
function mets(rows, pred) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const s = pred(r);
    if (r.y && s) tp++;
    else if (!r.y && s) fp++;
    else if (r.y) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  const fpr = fp + tn ? fp / (fp + tn) : null;
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return { n: rows.length, tp, fp, fn, tn, precision: r3(precision), recall: r3(recall), f1: r3(f1), fpr: r3(fpr) };
}

// ---------- 1) out-of-fold scores on the training pool, for the threshold ----------
const K = 5;
const folds = shuffle(train.map((_, i) => i), mulberry32(7));
const oof = new Float64Array(train.length);
for (let f = 0; f < K; f++) {
  const held = new Set(folds.filter((_, j) => j % K === f));
  const m = fit(train.filter((_, i) => !held.has(i)));
  for (const i of held) oof[i] = predict(m, train[i].messages);
}

// ---------- 2) final model on the whole pool ----------
const final = fit(train);
const qz = quantize(final);
const weightsB64 = Buffer.from(qz.q.buffer).toString("base64");
const shipped = { featureVersion: M.FEATURE_VERSION, bits: BITS, scale: qz.scale, bias: qz.bias, weights: weightsB64 };
const pShip = (messages, text) => {
  const r = M.score(text ?? messages.map((m) => m.text).join("\n"), { messages }, { ...shipped, threshold: 0.5, version: "probe" });
  return r ? r.p : 0;
};

// Rules verdicts (rules v4) for every sampled row, for the combined system.
const rulesKind = new Map();
for (const r of sample) {
  const v = await payRisk.detect(r.messages.map((m) => m.text).join("\n"), { messages: r.messages });
  rulesKind.set(r.id, v.kind === "risk" ? "risk" : v.silentReason);
}
const scored = sample.map((r) => ({
  id: r.id,
  dataset: r.dataset,
  split: r.split,
  y: r.label === "scam" ? 1 : 0,
  inTrain: TRAIN_SETS.has(r.dataset) && r.split === "dev",
  rules: rulesKind.get(r.id),
  p: pShip(r.messages)
}));

// Threshold: the lowest value where model-alone false alarms stay inside the budget on
// (a) out-of-fold legit rows from the training pool and (b) dev legit rows of SMS and Discord
// (never trained on). Never below 0.5.
const calibLegit = [
  ...train.map((r, i) => ({ y: r.y, p: oof[i] })).filter((r) => r.y === 0),
  ...scored.filter((r) => r.split === "dev" && !TRAIN_SETS.has(r.dataset) && r.y === 0)
];
const sortedLegit = calibLegit.map((r) => r.p).sort((a, b) => b - a);
const allowed = Math.floor(FPR_BUDGET * sortedLegit.length);
let threshold = Math.max(0.5, (sortedLegit[allowed] ?? 0.5) + 1e-6);
threshold = Math.round(threshold * 1000) / 1000 + 0.001;

// Combined product policy: rules risk stays risk; when rules are silent for lack of an ask
// (no_atom / weak_only, never veto or short), the model can add a card at p >= threshold.
const addable = (r) => r.rules === "no_atom" || r.rules === "weak_only";
const policies = {
  rules: (r) => r.rules === "risk",
  model: (r) => r.p >= threshold,
  rules_or_model: (r) => r.rules === "risk" || (addable(r) && r.p >= threshold)
};

function report(rows) {
  const out = {};
  for (const [name, pred] of Object.entries(policies)) out[name] = mets(rows, pred);
  return out;
}
const test = scored.filter((r) => r.split === "test");
const byDataset = {};
for (const ds of ["sms_spam", "discord", "scam_dialogue", "scamguardbench"]) byDataset[ds] = report(test.filter((r) => r.dataset === ds));

// Held-out marketplace set (never trained on, not read while building features).
const caseRows = [];
for (const c of cases) {
  const raw = c.messages.map((m) => m.text).join("\n");
  const v = await payRisk.detect(raw, { ...c.context, messages: c.messages });
  caseRows.push({ id: c.id, lang: c.lang, y: c.expect === "risk" ? 1 : 0, rules: v.kind === "risk" ? "risk" : v.silentReason, p: pShip(c.messages, raw) });
}

// Held-out synthetic chats from an author who never saw the model, the features or the training chats.
const heldRows = [];
for (const c of heldout) {
  const raw = c.messages.map((m) => m.text).join("\n");
  const v = await payRisk.detect(raw, { messages: c.messages });
  heldRows.push({ id: c.id, lang: c.lang, y: c.y, rules: v.kind === "risk" ? "risk" : v.silentReason, p: pShip(c.messages, raw) });
}

const oofMetrics = mets(train.map((r, i) => ({ y: r.y, p: oof[i] })), (r) => r.p >= threshold);
const seedOof = mets(train.map((r, i) => ({ ...r, p: oof[i] })).filter((r) => r.dataset === "seed"), (r) => r.p >= threshold);

const results = {
  at: new Date().toISOString(),
  rulesVersion: atoms.RULES_VERSION,
  featureVersion: M.FEATURE_VERSION,
  config: { bits: BITS, epochs: EPOCHS, l2: L2, lr: LR, fprBudget: FPR_BUDGET, sampleSeed: SEED },
  threshold,
  trainRows: train.length,
  trainByDataset: Object.fromEntries([...new Set(train.map((r) => r.dataset))].map((d) => [d, train.filter((r) => r.dataset === d).length])),
  weightsBytesBase64: weightsB64.length,
  outOfFold: { all: oofMetrics, seed: seedOof },
  test: { pooled: report(test), byDataset },
  heldout: heldRows.length ? { all: report(heldRows), da: report(heldRows.filter((r) => r.lang === "da")), en: report(heldRows.filter((r) => r.lang === "en")) } : null,
  marketplaceCases: { all: report(caseRows), da: report(caseRows.filter((r) => r.lang === "da")), en: report(caseRows.filter((r) => r.lang === "en")) },
  rows: {
    test: test.map((r) => ({ id: r.id, y: r.y, rules: r.rules, p: Math.round(r.p * 1e4) / 1e4 })),
    heldout: heldRows.map((r) => ({ id: r.id, y: r.y, rules: r.rules, p: Math.round(r.p * 1e4) / 1e4 })),
    cases: caseRows.map((r) => ({ id: r.id, y: r.y, rules: r.rules, p: Math.round(r.p * 1e4) / 1e4 }))
  }
};

const fmt = (m) => `n=${m.n} TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn} P=${m.precision} R=${m.recall} F1=${m.f1} FPR=${m.fpr}`;
console.log(`train rows ${train.length}`, results.trainByDataset, `threshold ${threshold}`);
console.log(`out-of-fold (train pool)  ${fmt(oofMetrics)}`);
console.log(`out-of-fold (seed only)   ${fmt(seedOof)}`);
for (const [name, m] of Object.entries(results.test.pooled)) console.log(`test pooled ${name.padEnd(15)} ${fmt(m)}`);
for (const [ds, rep] of Object.entries(byDataset)) for (const [name, m] of Object.entries(rep)) console.log(`test ${ds.padEnd(15)} ${name.padEnd(15)} ${fmt(m)}`);
if (results.heldout) for (const [sl, rep] of Object.entries(results.heldout)) for (const [name, m] of Object.entries(rep)) console.log(`heldout ${sl.padEnd(4)} ${name.padEnd(15)} ${fmt(m)}`);
for (const [sl, rep] of Object.entries(results.marketplaceCases)) for (const [name, m] of Object.entries(rep)) console.log(`cases ${sl.padEnd(4)} ${name.padEnd(15)} ${fmt(m)}`);

if (!argv.includes("--no-write")) {
  const version = `lr-h${BITS}-f${M.FEATURE_VERSION}-${new Date().toISOString().slice(0, 10)}`;
  const meta = { trainedOn: Object.keys(results.trainByDataset), trainRows: train.length, fprBudget: FPR_BUDGET };
  const js = "// Generated by research/chat-scams/train-model.mjs. Do not edit by hand.\n" +
    "// Int8 logistic-regression weights over 2^" + BITS + " hashed n-gram buckets. See scam-model.js.\n" +
    "globalThis.pbScamModelWeights = " + JSON.stringify({ ...shipped, threshold, version, meta }) + ";\n";
  writeFileSync(path.join(root, "extension/lib/scam-model-weights.js"), js);
  results.version = version;
  writeFileSync(path.join(here, "model-results.json"), JSON.stringify(results, null, 1) + "\n");
  console.log(`wrote extension/lib/scam-model-weights.js (${(js.length / 1024).toFixed(0)} KB), research/chat-scams/model-results.json`);
}
