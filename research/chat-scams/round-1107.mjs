// Round 1107 driver: retrain the on-device chat-scam model with new synthetic data,
// pick a threshold on real-dev false alarms, and evaluate the frozen winner once.
//
//   node research/chat-scams/round-1107.mjs validate     # schema, group split, exact/near-dup counts
//   node research/chat-scams/round-1107.mjs train        # snapshot data, fit 3 frozen configs, select, freeze
//   node research/chat-scams/round-1107.mjs final-test   # score frozen winner + shipped baseline once
//   options: --out-dir=<dir> (default ../runs/round-1107 next to the repo), --data-dir=data/chat-scams
//
// Same featurizer (extension/lib/scam-model.js), loss and int8 quantization as train-model.mjs.
// train-model.mjs and the shipped weights are not touched; this script writes only into --out-dir.
// Training: public synthetic non-test rows + seed + train-synth (v1) + train-synth-v2. Never SMS or Discord.
// Real SMS/Discord dev rows: only legit-row false alarms, only to set the threshold. Their TPs are not reported
// in train mode and never used for selection. Test split, heldout100 and holdout-v2 are scored only in final-test.
// Output: metrics, counts, ids and hashes. No message text, ever (assertTextFree runs before every write).
//
// Revision note: the round-1107 results in research/chat-scams/round-1107/ were produced by the ORIGINAL
// revision of this file (sha256 f5565714d879361dc738814453c13d9f8be0074a55cf8b28d4f131da50fb8ef9).
// This revision adds guards after the audit: ship needs a dev gain (F1), empty calibration groups throw (F3),
// the snapshot hashes the code (F5), validate rejects labels that turn counts alone separate (F6), and parse
// errors name file:line only (F7). NOT ready for a production round: the test ledger still lives under
// --out-dir (F4), and seed rows bypass dedupe (F9). See research/chat-scams/ROUND-1107.md.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../extension/lib/scam-model.js";
import "../../extension/lib/scam-model-weights.js";
import { payRisk } from "../../extension/lib/index.js";
import { sampleBalanced, mulberry32, shuffle } from "../../eval/real/sample.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const M = globalThis.pbScamModel;
const SHIPPED = globalThis.pbScamModelWeights;

// ---------- frozen before any fit ----------
export const BITS = 18;
export const LR = 0.5;
export const TRAIN_SEED = 11;
export const SAMPLE_SEED = 20261026;
export const MARGIN = 0.02;
export const MAX_WEIGHTS_FILE_BYTES = 500 * 1024;
export const CONSTRAINTS = { discordDevExtraFP: 0, smsDevExtraFP: 1, synthDevExtraFPR: 0.03, minThreshold: 0.5 };
export const CONFIGS = Object.freeze([
  Object.freeze({ id: "C1-v2-default", epochs: 12, l2: 1e-6, legitWeight: 1 }),
  Object.freeze({ id: "C2-legit1.5", epochs: 12, l2: 1e-6, legitWeight: 1.5 }),
  Object.freeze({ id: "C3-reg-e8-l2e-5", epochs: 8, l2: 1e-5, legitWeight: 1 })
]);
export const PUBLIC_TRAIN_SETS = new Set(["scam_dialogue", "scamguardbench"]);
export const REAL_SETS = new Set(["sms_spam", "discord"]);
const SYNTH_LEGIT_SETS = new Set(["seed", "train_synth", "train_synth_v2"]);
const V2_FILES = { train: "train-synth-v2.jsonl", dev: "dev-synth-v2.jsonl", holdout: "holdout-v2.jsonl" };

export const keyOf = (messages) => messages.map((m) => m.text).join("\n").trim().toLowerCase();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---------- text-free guard ----------
const FORBIDDEN_KEYS = new Set(["text", "messages", "message", "evidence", "snippet", "raw", "body", "content", "scenario"]);
// Any string longer than 80 chars or with 6+ words fails, so no 8-word span of a dataset row can appear.
export function assertTextFree(obj, where = "$") {
  if (typeof obj === "string") {
    if (obj.length > 80 || obj.trim().split(/\s+/).length >= 6) throw new Error(`text-like string at ${where}`);
    return true;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertTextFree(v, `${where}[${i}]`)); return true; }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.has(k)) throw new Error(`forbidden key ${where}.${k}`);
      assertTextFree(v, `${where}.${k}`);
    }
  }
  return true;
}
function writeJson(file, obj) {
  assertTextFree(obj);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 1) + "\n");
}

// ---------- data ----------
// JSON.parse errors can quote part of the line, so only file and line number are reported.
export function parseJsonl(raw, label) {
  const out = [];
  raw.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    try { out.push(JSON.parse(l)); } catch (_) { throw new Error(`${label}: invalid JSON at line ${i + 1}`); }
  });
  return out;
}
export function parseChats(raw, dataset) {
  return parseJsonl(raw, dataset).map((c) => ({
    id: c.id, lang: c.lang, dataset, family: c.family ?? null, template_id: c.template_id ?? null, split: c.split ?? null,
    label: c.label, y: c.label === "scam" ? 1 : 0,
    fromRaw: (c.messages || []).map((m) => m && m.from),
    messages: (c.messages || []).map((m) => ({ from: m.from === "me" ? "buyer" : "seller", text: String(m.text ?? "") }))
  }));
}
function readChats(file, dataset) {
  return existsSync(file) ? parseChats(readFileSync(file, "utf8"), dataset) : [];
}
function readSeed() {
  return parseJsonl(readFileSync(path.join(root, "data/chat-scams/seed.jsonl"), "utf8"), "seed").map((s) => ({
    id: s.id, lang: s.lang, dataset: "seed", y: s.label === "scam" ? 1 : 0,
    messages: s.messages.map((m) => ({ from: m.speaker === "user" ? "buyer" : "seller", text: m.text }))
  }));
}
function readCases() {
  return JSON.parse(readFileSync(path.join(root, "eval/cases/pay-risk.json"), "utf8")).cases.map((c) => ({
    id: c.id, lang: c.lang, dataset: "pay_risk_cases", y: c.expect === "risk" ? 1 : 0, context: c.context, messages: c.messages
  }));
}

async function loadEverything(dataDir) {
  const { loadAll } = await import("../../eval/real/load.mjs");
  const all = loadAll();
  const sample = sampleBalanced(all, { seed: SAMPLE_SEED, cap: 500 });
  const dir = path.resolve(root, dataDir);
  return {
    all, sample, dataDir: dir,
    seed: readSeed(),
    synthV1: readChats(path.join(root, "data/chat-scams/train-synth.jsonl"), "train_synth"),
    heldout: readChats(path.join(root, "data/chat-scams/heldout.jsonl"), "heldout100"),
    cases: readCases(),
    v2: {
      train: readChats(path.join(dir, V2_FILES.train), "train_synth_v2"),
      dev: readChats(path.join(dir, V2_FILES.dev), "dev_synth_v2"),
      holdout: readChats(path.join(dir, V2_FILES.holdout), "holdout_v2")
    }
  };
}

// File hashes + an in-memory hash of the real split (ids, labels, splits, text hashes). Compared at final-test.
function snapshot(D) {
  const files = {};
  for (const rel of ["data/chat-scams/seed.jsonl", "data/chat-scams/train-synth.jsonl", "data/chat-scams/heldout.jsonl", "eval/cases/pay-risk.json"]) {
    files[rel] = sha256(readFileSync(path.join(root, rel)));
  }
  for (const f of Object.values(V2_FILES)) {
    const p = path.join(D.dataDir, f);
    files[path.relative(root, p)] = existsSync(p) ? sha256(readFileSync(p)) : null;
  }
  const split = D.sample.map((r) => `${r.id}|${r.dataset}|${r.split}|${r.label}|${sha256(keyOf(r.messages))}`).sort().join("\n");
  const code = {};
  for (const rel of ["research/chat-scams/round-1107.mjs", "extension/lib/scam-model.js", "extension/lib/pay-risk.js"]) {
    code[rel] = sha256(readFileSync(path.join(root, rel)));
  }
  return { files, code, realSplitSha256: sha256(split), realSplitRows: D.sample.length, shippedWeightsSha256: sha256(SHIPPED.weights) };
}

// ---------- validation: schema, group split, exact and near duplicates (counts/ids only) ----------
function shingles(messages) {
  const t = M.normalize(M.counterpartyText(messages));
  const s = new Set();
  for (let i = 0; i + 5 <= t.length; i++) s.add(M.hash(t.slice(i, i + 5)));
  return Int32Array.from(s).sort();
}
function jaccard(a, b) {
  let i = 0, j = 0, inter = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { inter++; i++; j++; } else if (a[i] < b[j]) i++; else j++;
  }
  return inter / (a.length + b.length - inter || 1);
}
// Ids of `rows` with a near-duplicate (char-5-gram Jaccard >= thr) in `refs`.
export function nearDupIds(rows, refs, thr = 0.6) {
  const R = refs.map((r) => r.sh || (r.sh = shingles(r.messages)));
  const hits = [];
  for (const r of rows) {
    const a = r.sh || (r.sh = shingles(r.messages));
    if (!a.length) continue;
    for (const b of R) {
      const lo = Math.min(a.length, b.length), hi = Math.max(a.length, b.length);
      if (!b.length || lo / hi < thr) continue;
      if (jaccard(a, b) >= thr) { hits.push(r.id); break; }
    }
  }
  return hits;
}
export function exactDupIds(rows, refs) {
  const keys = new Set(refs.map((r) => keyOf(r.messages)));
  return rows.filter((r) => keys.has(keyOf(r.messages))).map((r) => r.id);
}

export function validateV2(D) {
  const errors = [];
  const out = { counts: {}, schemaErrors: 0, templateOverlap: [], familyOverlap: {}, exactDup: {}, nearDup: {}, holdoutFamiliesNotInTrain: [] };
  const ids = new Set();
  for (const [split, rows] of Object.entries(D.v2)) {
    out.counts[split] = { n: rows.length, scam: rows.filter((r) => r.y).length, legit: rows.filter((r) => !r.y).length,
      da: rows.filter((r) => r.lang === "da").length, en: rows.filter((r) => r.lang === "en").length };
    if (!rows.length) errors.push(`${split}: file missing or empty`);
    for (const r of rows) {
      const bad = !r.id || ids.has(r.id) || !["scam", "legit"].includes(r.label) || !r.family || !r.template_id ||
        (r.split && r.split !== split) || !r.messages.length || !r.fromRaw.every((f) => f === "them" || f === "me") ||
        !r.messages.some((m) => m.from === "seller" && m.text.trim());
      if (bad) out.schemaErrors++;
      ids.add(r.id);
    }
  }
  if (out.schemaErrors) errors.push(`${out.schemaErrors} schema errors`);
  const tpl = (rows) => new Set(rows.map((r) => r.template_id));
  const fam = (rows) => new Set(rows.map((r) => r.family));
  const pairs = [["train", "dev"], ["train", "holdout"], ["dev", "holdout"]];
  for (const [a, b] of pairs) {
    const tb = tpl(D.v2[b]);
    for (const t of tpl(D.v2[a])) if (tb.has(t)) out.templateOverlap.push(`${a}/${b}:${t}`);
    const fb = fam(D.v2[b]);
    out.familyOverlap[`${a}/${b}`] = [...fam(D.v2[a])].filter((f) => fb.has(f)).length;
  }
  if (out.templateOverlap.length) errors.push(`template_id shared across splits: ${out.templateOverlap.length}`);
  const trainFam = fam(D.v2.train);
  out.holdoutFamiliesNotInTrain = [...fam(D.v2.holdout)].filter((f) => !trainFam.has(f));

  const real = D.all.filter((r) => REAL_SETS.has(r.dataset));
  const publicTest = D.sample.filter((r) => r.split === "test" && PUBLIC_TRAIN_SETS.has(r.dataset));
  const refs = {
    seed: D.seed, train_synth_v1: D.synthV1, heldout100: D.heldout, pay_risk_cases: D.cases,
    real_sms_discord: real, public_test: publicTest, dev_v2: D.v2.dev, holdout_v2: D.v2.holdout, train_v2: D.v2.train
  };
  for (const split of ["train", "dev", "holdout"]) {
    const rows = D.v2[split];
    const self = new Set(), within = [];
    for (const r of rows) { const k = keyOf(r.messages); if (self.has(k)) within.push(r.id); self.add(k); }
    out.exactDup[`${split}:within`] = within.length;
    for (const [name, ref] of Object.entries(refs)) {
      if (name === `${split}_v2`) continue;
      out.exactDup[`${split}:${name}`] = exactDupIds(rows, ref).length;
      out.nearDup[`${split}:${name}`] = nearDupIds(rows, ref).length;
    }
  }
  // Borrowed real/heldout text in dev or holdout poisons the evaluation: hard error.
  for (const split of ["dev", "holdout"]) {
    for (const name of ["real_sms_discord", "heldout100", "pay_risk_cases", "public_test", "train_synth_v1", "seed"]) {
      if (out.exactDup[`${split}:${name}`] || out.nearDup[`${split}:${name}`]) errors.push(`${split} overlaps ${name}`);
    }
  }
  if (out.exactDup["dev:holdout_v2"] || out.nearDup["dev:holdout_v2"]) errors.push("dev overlaps holdout_v2");
  out.structuralShortcuts = Object.entries(D.v2).flatMap(([split, rows]) => structuralShortcuts(rows).map((p) => `${split}:${p}`));
  if (out.structuralShortcuts.length) errors.push(`label separable by: ${out.structuralShortcuts.join(",")}`);
  return { ok: errors.length === 0, errors, ...out };
}

// A label that turn counts or the opener alone predict is a shortcut, not a scam signal.
export function structuralShortcuts(rows) {
  const probes = {
    turns: (r) => r.messages.length,
    themTurns: (r) => r.messages.filter((m) => m.from !== "buyer").length,
    opener: (r) => (r.messages[0] ? r.messages[0].from : "")
  };
  const hits = [];
  for (const [name, fn] of Object.entries(probes)) {
    const labelsByValue = new Map();
    for (const r of rows) {
      const v = fn(r);
      if (!labelsByValue.has(v)) labelsByValue.set(v, new Set());
      labelsByValue.get(v).add(r.y);
    }
    const both = rows.some((r) => r.y) && rows.some((r) => !r.y);
    if (both && rows.length >= 4 && [...labelsByValue.values()].every((s) => s.size === 1)) hits.push(name);
  }
  return hits;
}

// Train-v2 rows that duplicate or nearly duplicate any evaluation row are dropped (ids reported).
function trainV2Drops(D) {
  const evalRefs = [...D.v2.dev, ...D.v2.holdout, ...D.heldout, ...D.cases, ...D.all.filter((r) => REAL_SETS.has(r.dataset)),
    ...D.sample.filter((r) => r.split === "test")];
  return new Set([...exactDupIds(D.v2.train, evalRefs), ...nearDupIds(D.v2.train, evalRefs)]);
}

// ---------- training pool: never SMS/Discord, never a test row, never an evaluation row ----------
export function buildTrainPool({ all, sample, seed, synthV1, synthV2, excludeKeys = new Set() }) {
  const testIds = new Set(sample.filter((r) => r.split === "test").map((r) => r.id));
  const blocked = new Set([...excludeKeys, ...sample.filter((r) => r.split === "test").map((r) => keyOf(r.messages))]);
  const seen = new Set();
  const pool = [];
  const push = (r, dataset) => {
    if (REAL_SETS.has(dataset)) throw new Error(`refusing to train on ${dataset}`);
    const k = keyOf(r.messages);
    if (!k || blocked.has(k) || seen.has(k)) return;
    seen.add(k);
    pool.push({ id: r.id, dataset, y: r.y ?? (r.label === "scam" ? 1 : 0), messages: r.messages });
  };
  for (const r of all) if (PUBLIC_TRAIN_SETS.has(r.dataset) && !testIds.has(r.id)) push(r, r.dataset);
  for (const r of seed) pool.push({ id: r.id, dataset: "seed", y: r.y, messages: r.messages }); // as train-model.mjs
  for (const r of synthV1) push(r, "train_synth");
  for (const r of synthV2) push(r, "train_synth_v2");
  for (const r of pool) if (REAL_SETS.has(r.dataset)) throw new Error("real row in training pool");
  return pool;
}

// ---------- model (same as train-model.mjs, plus legitWeight on synthetic legit rows) ----------
const feats = (messages) => M.featurize(M.counterpartyText(messages), BITS);
export function fit(rows, { epochs, l2, legitWeight = 1, seedRand = TRAIN_SEED }) {
  const w = new Float32Array(1 << BITS);
  const g2 = new Float32Array(1 << BITS).fill(1e-8);
  let b = 0, gb2 = 1e-8;
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
      const cw = rows[i].y ? wPos : wNeg * (SYNTH_LEGIT_SETS.has(rows[i].dataset) ? legitWeight : 1);
      const err = (p - rows[i].y) * cw;
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j];
        const g = err * val[j] + l2 * w[k];
        g2[k] += g * g;
        w[k] -= (LR / Math.sqrt(g2[k])) * g;
      }
      gb2 += err * err;
      b -= (LR / Math.sqrt(gb2)) * err;
    }
  }
  return { w, b };
}
export function quantize(model) {
  let max = 0;
  for (const v of model.w) max = Math.max(max, Math.abs(v));
  const scale = max / 127 || 1;
  const q = new Int8Array(model.w.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(model.w[i] / scale)));
  return { featureVersion: M.FEATURE_VERSION, bits: BITS, scale, bias: model.b, weights: Buffer.from(q.buffer).toString("base64") };
}
// Probability exactly as the browser computes it (runtime score(), quantized weights).
export function pShip(weights, messages) {
  const r = M.score(messages.map((m) => m.text).join("\n"), { messages }, { ...weights, threshold: 0.5, version: "probe" });
  return r ? r.p : 0;
}
export function weightsJs(weights, threshold, version, meta) {
  return "// Generated by research/chat-scams/round-1107.mjs. Do not edit by hand.\n" +
    "// Int8 logistic-regression weights over 2^" + weights.bits + " hashed n-gram buckets. See scam-model.js.\n" +
    "globalThis.pbScamModelWeights = " + JSON.stringify({ ...weights, threshold, version, meta }) + ";\n";
}

// ---------- policy (unchanged product gate) and metrics ----------
export const addable = (rules) => rules === "no_atom" || rules === "weak_only";
export const combined = (r, t) => r.rules === "risk" || (addable(r.rules) && r.p >= t);
export const modelAdds = (r, t) => r.rules !== "risk" && addable(r.rules) && r.p >= t;

async function rulesOf(r) {
  const raw = r.messages.map((m) => m.text).join("\n");
  const v = await payRisk.detect(raw, { ...(r.context || {}), messages: r.messages });
  return v.kind === "risk" ? "risk" : v.silentReason;
}
async function scoreRows(rows, weightsList) {
  const out = [];
  for (const r of rows) {
    const s = { id: r.id, dataset: r.dataset, y: r.y ?? (r.label === "scam" ? 1 : 0), rules: await rulesOf(r) };
    s.p = weightsList.map((w) => pShip(w, r.messages));
    out.push(s);
  }
  return out;
}
export function mets(rows, pred) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const s = pred(r);
    if (r.y && s) tp++; else if (!r.y && s) fp++; else if (r.y) fn++; else tn++;
  }
  const scamN = tp + fn, legitN = fp + tn;
  return { n: rows.length, scamN, legitN, tp, fp, fn, tn, fpOfLegit: `${fp}/${legitN}`,
    precision: r3(tp + fp ? tp / (tp + fp) : null), recall: r3(scamN ? tp / scamN : null), fpr: r3(legitN ? fp / legitN : null) };
}
function report(rows, t) {
  return { rules: mets(rows, (r) => r.rules === "risk"), model: mets(rows, (r) => r.p >= t), rules_or_model: mets(rows, (r) => combined(r, t)) };
}

// ---------- threshold: lowest t meeting all FP constraints, then + margin ----------
// rows: { group: "discord_dev" | "sms_dev" | "synth_dev", y, rules, p }. Only legit rows matter.
export function pickThreshold(rows, c = CONSTRAINTS, margin = MARGIN) {
  const need = (group, allowed) => {
    const ps = rows.filter((r) => r.group === group && !r.y && addable(r.rules)).map((r) => r.p).sort((a, b) => b - a);
    return ps.length > allowed ? ps[allowed] + 1e-6 : 0;
  };
  for (const group of ["discord_dev", "sms_dev", "synth_dev"]) {
    if (!rows.some((r) => r.group === group && !r.y)) throw new Error(`calibration group ${group} has no legit rows`);
  }
  const synthLegitN = rows.filter((r) => r.group === "synth_dev" && !r.y).length;
  const synthAllowed = Math.floor(c.synthDevExtraFPR * synthLegitN + 1e-9);
  const base = Math.max(c.minThreshold, need("discord_dev", c.discordDevExtraFP), need("sms_dev", c.smsDevExtraFP), need("synth_dev", synthAllowed));
  const threshold = Math.ceil((base + margin) * 1000) / 1000;
  const extra = (group) => rows.filter((r) => r.group === group && !r.y && modelAdds(r, threshold)).length;
  const legitN = (group) => rows.filter((r) => r.group === group && !r.y).length;
  const check = {
    discordDevExtraFP: `${extra("discord_dev")}/${legitN("discord_dev")}`,
    smsDevExtraFP: `${extra("sms_dev")}/${legitN("sms_dev")}`,
    synthDevExtraFP: `${extra("synth_dev")}/${synthLegitN}`,
    fragilityRealDev: rows.filter((r) => (r.group === "discord_dev" || r.group === "sms_dev") && !r.y && addable(r.rules) &&
      r.p >= threshold - 0.1 && r.p < threshold).length
  };
  const feasible = threshold < 1 && extra("discord_dev") <= c.discordDevExtraFP && extra("sms_dev") <= c.smsDevExtraFP &&
    extra("synth_dev") <= synthAllowed;
  return { threshold, feasible, check };
}

// Winner: feasible candidate with the highest synthetic-dev combined recall; ties -> fewer synth-dev FP, then config order.
export function selectWinner(cands) {
  const ok = cands.filter((c) => c.feasible);
  ok.sort((a, b) => (b.synthDev.rules_or_model.recall - a.synthDev.rules_or_model.recall) ||
    (a.synthDev.rules_or_model.fp - b.synthDev.rules_or_model.fp) || (a.order - b.order));
  return ok[0] || null;
}

// Ship only when the frozen candidate improved on synthetic dev AND passes every final-test check.
export const DEV_GAIN = "candidate_beats_baseline_on_synth_dev";
export function shipDecision({ devVerdict, discordFp, realTpWin, realTpBase, smsFpWin, smsFpBase }) {
  const pass = {
    devGainBeforeTest: devVerdict === DEV_GAIN,
    discordFpAtMost1of250: discordFp <= 1,
    pooledRealRecallImproved: realTpWin > realTpBase,
    smsFpWithinBaselinePlus1: smsFpWin <= smsFpBase + 1
  };
  return { pass, decision: Object.values(pass).every(Boolean) ? "ship" : "reject" };
}

// ---------- modes ----------
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const h = argv.find((a) => a.startsWith(`--${name}=`)); return h ? h.slice(name.length + 3) : dflt; };
const outDir = path.resolve(opt("out-dir", path.join(root, "..", "runs", "round-1107")));
const dataDir = opt("data-dir", "data/chat-scams");

async function cmdValidate() {
  const D = await loadEverything(dataDir);
  const v = validateV2(D);
  const res = { mode: "validate", at: new Date().toISOString(), snapshot: snapshot(D), ...v, trainV2DropIds: [...trainV2Drops(D)] };
  writeJson(path.join(outDir, "validate.json"), res);
  console.log(JSON.stringify({ ok: v.ok, errors: v.errors, counts: v.counts, templateOverlap: v.templateOverlap.length,
    exactDup: v.exactDup, nearDup: v.nearDup, trainV2Drops: res.trainV2DropIds.length }, null, 1));
  if (!v.ok) process.exitCode = 1;
}

async function cmdTrain() {
  const D = await loadEverything(dataDir);
  const v = validateV2(D);
  if (!v.ok) { console.error("validate failed:", v.errors.join("; ")); process.exit(1); }
  const snap = snapshot(D);
  writeJson(path.join(outDir, "snapshot.json"), snap);
  const drops = trainV2Drops(D);
  const evalKeys = new Set([...D.v2.dev, ...D.v2.holdout, ...D.heldout, ...D.cases, ...D.all.filter((r) => REAL_SETS.has(r.dataset))].map((r) => keyOf(r.messages)));
  const pool = buildTrainPool({ all: D.all, sample: D.sample, seed: D.seed, synthV1: D.synthV1,
    synthV2: D.v2.train.filter((r) => !drops.has(r.id)), excludeKeys: evalKeys });
  const trainByDataset = {};
  for (const r of pool) trainByDataset[r.dataset] = (trainByDataset[r.dataset] || 0) + 1;
  console.log("train rows", pool.length, trainByDataset, "train-v2 dropped", drops.size);

  // Calibration rows: legit labels from real dev (SMS, Discord) + synthetic dev. Real-dev scams are not scored.
  const realDevLegit = D.sample.filter((r) => r.split === "dev" && REAL_SETS.has(r.dataset) && r.label === "legit");
  const cands = [];
  for (const [order, cfg] of CONFIGS.entries()) {
    const weights = quantize(fit(pool, cfg));
    const js = weightsJs(weights, 0.5, "probe", {});
    if (js.length >= MAX_WEIGHTS_FILE_BYTES) throw new Error(`${cfg.id}: weights file ${js.length} B >= 500 KB`);
    const real = await scoreRows(realDevLegit, [weights]);
    const synth = await scoreRows(D.v2.dev, [weights]);
    const calib = [
      ...real.map((r) => ({ group: r.dataset === "discord" ? "discord_dev" : "sms_dev", y: 0, rules: r.rules, p: r.p[0] })),
      ...synth.map((r) => ({ group: "synth_dev", y: r.y, rules: r.rules, p: r.p[0] }))
    ];
    const t = pickThreshold(calib);
    const synthRows = synth.map((r) => ({ ...r, p: r.p[0] }));
    const c = { order, config: cfg, threshold: t.threshold, feasible: t.feasible, constraintCheck: t.check,
      synthDev: report(synthRows, t.threshold), weightsFileBytes: js.length, weightsSha256: sha256(weights.weights) };
    console.log(cfg.id, "t", t.threshold, "feasible", t.feasible, t.check, "synthDev R", c.synthDev.rules_or_model.recall, "FP", c.synthDev.rules_or_model.fpOfLegit);
    c._weights = weights;
    cands.push(c);
  }
  // Shipped baseline on the same synthetic dev, at its shipped threshold (reference only).
  const base = (await scoreRows(D.v2.dev, [SHIPPED])).map((r) => ({ ...r, p: r.p[0] }));
  const baselineSynthDev = report(base, SHIPPED.threshold);

  const win = selectWinner(cands);
  const res = {
    mode: "train", at: new Date().toISOString(), snapshot: snap, configs: CONFIGS, constraints: CONSTRAINTS, margin: MARGIN,
    trainSeed: TRAIN_SEED, bits: BITS, trainRows: pool.length, trainByDataset, trainV2DropIds: [...drops],
    candidates: cands.map(({ _weights, ...c }) => c),
    baseline: { version: SHIPPED.version, threshold: SHIPPED.threshold, synthDev: baselineSynthDev },
    winner: win ? win.config.id : null,
    devVerdict: !win ? "no_feasible_candidate"
      : win.synthDev.rules_or_model.recall > baselineSynthDev.rules_or_model.recall ? "candidate_beats_baseline_on_synth_dev" : "no_improvement_on_synth_dev"
  };
  if (win) {
    const version = `lr-h${BITS}-f${M.FEATURE_VERSION}-r1107-${win.config.id}`;
    const meta = { trainedOn: Object.keys(trainByDataset), trainRows: pool.length, round: "1107" };
    const frozen = { candidate: win.config.id, config: win.config, threshold: win.threshold, version, meta, devVerdict: res.devVerdict,
      weightsSha256: win.weightsSha256, snapshot: snap, weights: win._weights };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "frozen.json"), JSON.stringify(frozen) + "\n");
    writeFileSync(path.join(outDir, "frozen-scam-model-weights.js"), weightsJs(win._weights, win.threshold, version, meta));
    res.frozen = { file: "frozen.json", weightsSha256: win.weightsSha256, threshold: win.threshold };
  }
  writeJson(path.join(outDir, "train-results.json"), res);
  console.log("winner", res.winner, res.devVerdict);
}

async function cmdFinalTest() {
  const frozenFile = path.resolve(opt("frozen", path.join(outDir, "frozen.json")));
  const F = JSON.parse(readFileSync(frozenFile, "utf8"));
  if (sha256(F.weights.weights) !== F.weightsSha256) throw new Error("frozen weights hash mismatch");
  const ledger = path.join(outDir, "test-access-ledger.jsonl");
  if (existsSync(ledger) && readFileSync(ledger, "utf8").includes(F.weightsSha256)) {
    throw new Error("final-test already ran for these frozen weights; a rerun would turn test into dev");
  }
  const D = await loadEverything(dataDir);
  const snap = snapshot(D);
  if (JSON.stringify(snap.files) !== JSON.stringify(F.snapshot.files) || snap.realSplitSha256 !== F.snapshot.realSplitSha256 ||
      JSON.stringify(snap.code) !== JSON.stringify(F.snapshot.code)) {
    throw new Error("datasets, real split or driver/runtime code changed since freeze");
  }
  appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), candidate: F.candidate, weightsSha256: F.weightsSha256 }) + "\n");

  const W = [SHIPPED, F.weights];
  const T = [SHIPPED.threshold, F.threshold];
  const sets = {
    discord_test: D.sample.filter((r) => r.split === "test" && r.dataset === "discord"),
    sms_test: D.sample.filter((r) => r.split === "test" && r.dataset === "sms_spam"),
    scam_dialogue_test: D.sample.filter((r) => r.split === "test" && r.dataset === "scam_dialogue"),
    scamguardbench_test: D.sample.filter((r) => r.split === "test" && r.dataset === "scamguardbench"),
    heldout100: D.heldout, holdout_v2: D.v2.holdout, pay_risk_cases: D.cases
  };
  const results = {};
  const scored = {};
  for (const [name, rows] of Object.entries(sets)) {
    const s = await scoreRows(rows, W);
    scored[name] = s;
    const as = (k) => s.map((r) => ({ ...r, p: r.p[k] }));
    results[name] = { rules: mets(s, (r) => r.rules === "risk"),
      baseline_rules_or_model: mets(as(0), (r) => combined(r, T[0])), winner_rules_or_model: mets(as(1), (r) => combined(r, T[1])),
      baseline_model: mets(as(0), (r) => r.p >= T[0]), winner_model: mets(as(1), (r) => r.p >= T[1]) };
  }
  const pooledReal = (k) => mets([...scored.discord_test, ...scored.sms_test].map((r) => ({ ...r, p: r.p[k] })), (r) => combined(r, T[k]));
  const realBase = pooledReal(0), realWin = pooledReal(1);
  const d = results.discord_test.winner_rules_or_model, sB = results.sms_test.baseline_rules_or_model, sW = results.sms_test.winner_rules_or_model;
  const { pass, decision } = shipDecision({ devVerdict: F.devVerdict, discordFp: d.fp, realTpWin: realWin.tp, realTpBase: realBase.tp,
    smsFpWin: sW.fp, smsFpBase: sB.fp });
  const out = {
    mode: "final-test", at: new Date().toISOString(), candidate: F.candidate, winnerThreshold: F.threshold, winnerVersion: F.version,
    baselineVersion: SHIPPED.version, baselineThreshold: SHIPPED.threshold, weightsSha256: F.weightsSha256,
    results, pooledRealTest: { baseline_rules_or_model: realBase, winner_rules_or_model: realWin }, shipRule: pass,
    decision,
    caveats: ["synthetic_training_and_holdout_v2", "real_test_and_heldout100_scored_in_earlier_rounds", "discord_fp_on_250_legit_rows", "no_retuning_after_final_test"],
    rows: Object.fromEntries(Object.entries(scored).map(([k, s]) => [k, s.map((r) => ({ id: r.id, y: r.y, rules: r.rules,
      pBase: Math.round(r.p[0] * 1e4) / 1e4, pWin: Math.round(r.p[1] * 1e4) / 1e4 }))]))
  };
  writeJson(path.join(outDir, "final-results.json"), out);
  for (const [name, rep] of Object.entries(results)) {
    for (const [k, m] of Object.entries(rep)) console.log(name.padEnd(20), k.padEnd(24), `TP=${m.tp}/${m.scamN} FP=${m.fpOfLegit} P=${m.precision} R=${m.recall}`);
  }
  console.log("decision", out.decision, pass);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = argv.find((a) => !a.startsWith("--"));
  const run = { validate: cmdValidate, train: cmdTrain, "final-test": cmdFinalTest }[mode];
  if (!run) { console.error("usage: round-1107.mjs validate|train|final-test [--out-dir=] [--data-dir=] [--frozen=]"); process.exit(2); }
  await run();
}
