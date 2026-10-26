// Real-message eval: runs PayBrake's rules engine (and optionally rules+LLM) on
// public Hugging Face scam/ham datasets. See eval/real/README.md.
//
//   node eval/real/download.mjs
//   node eval/real/run-real.mjs                 # rules only, all sampled rows
//   node eval/real/run-real.mjs --llm --llm-n=200   # + rules+LLM and LLM-alone on a test-split subsample
//
// Writes eval/real/results/rules-v<RULES_VERSION>.json (+ llm-v<N>.json). No message text is written to results/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payRisk, atoms } from "../../extension/lib/index.js";
import { loadAll } from "./load.mjs";
import { sampleBalanced, mulberry32, shuffle } from "./sample.mjs";
import { metrics, groupMetrics, printSummary } from "./metrics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, "results");
const localDir = path.join(here, ".data");
const SEED = 20261026;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes("--" + name);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : dflt;
};

function textOf(item) {
  return item.messages.map((m) => m.text).join("\n");
}

async function runOne(item, options = {}) {
  const text = textOf(item);
  const v = await payRisk.detect(text, { messages: item.messages }, options);
  return {
    got: v.kind === "risk" ? "risk" : "silent",
    level: v.level || null,
    silentReason: v.silentReason || null,
    signals: v.signals || [],
    evidence: (v.evidence || []).map((e) => e.text).slice(0, 4),
    llm: v.llm || "off"
  };
}

async function makeLlm() {
  const { classifyText } = await import("../../backend/src/classify.js");
  let calls = 0;
  let errors = 0;
  const ask = async (payload) => {
    calls++;
    try {
      return await classifyText(String(payload.text).slice(0, 4000), process.env);
    } catch (e) {
      errors++;
      throw e;
    }
  };
  return { ask, stats: () => ({ calls, errors }) };
}

async function main() {
  const all = loadAll();
  const sample = sampleBalanced(all, { seed: SEED, cap: 500 });
  const rows = [];
  const local = [];
  for (const item of sample) {
    const res = await runOne(item);
    const row = { id: item.id, dataset: item.dataset, split: item.split, label: item.label, subtype: item.subtype, payAsk: item.payAsk, nMessages: item.messages.length, ...res };
    rows.push(row);
    local.push({ ...row, text: textOf(item).slice(0, 1500) });
  }
  const g = groupMetrics(rows);
  printSummary(`rules v${atoms.RULES_VERSION} (seed ${SEED})`, g);
  mkdirSync(resultsDir, { recursive: true });
  const tag = opt("tag", "rules-v" + atoms.RULES_VERSION);
  writeFileSync(path.join(resultsDir, tag + ".json"), JSON.stringify({ rulesVersion: atoms.RULES_VERSION, seed: SEED, at: new Date().toISOString(), metrics: g, rows }, null, 1) + "\n");
  writeFileSync(path.join(localDir, tag + ".local.json"), JSON.stringify(local, null, 1));
  console.log("wrote results/" + tag + ".json");

  if (!flag("llm")) return;
  if (!process.env.OPENROUTER_API_KEY && !process.env.LLM_BASE_URL) {
    console.log("LLM skipped: OPENROUTER_API_KEY not set");
    return;
  }
  const n = Number(opt("llm-n", "200"));
  // Test split only, stratified: equal share per dataset x label.
  const strata = [...new Set(sample.filter((s) => s.split === "test").map((s) => s.dataset + "|" + s.label))];
  const per = Math.floor(n / strata.length);
  const rand = mulberry32(SEED + 7);
  const sub = strata.flatMap((k) => shuffle(sample.filter((s) => s.split === "test" && s.dataset + "|" + s.label === k), rand).slice(0, per));
  const llm = await makeLlm();
  const llmRows = [];
  const localLlm = [];
  for (const item of sub) {
    const rules = rows.find((r) => r.id === item.id);
    // rules+LLM exactly as the product does it: LLM is only consulted on a rules hit and can only confirm or lower.
    const combined = await runOne(item, { askLlm: llm.ask, timeoutMs: 15000 });
    // LLM alone: what the model says if asked about every message (not how the product works today).
    let alone = { got: "silent", err: null };
    try {
      const out = await llm.ask({ text: textOf(item) });
      alone = { got: out.risky ? "risk" : "silent", level: out.level, err: null, evidence: out.evidence };
    } catch (e) {
      alone = { got: "silent", err: e.code || "error" };
    }
    const row = { id: item.id, dataset: item.dataset, label: item.label, subtype: item.subtype, rules: rules.got, combined: combined.got, combinedLlm: combined.llm, alone: alone.got, aloneErr: alone.err };
    llmRows.push(row);
    localLlm.push({ ...row, aloneEvidence: alone.evidence, text: textOf(item).slice(0, 1500) });
  }
  const view = (key) => llmRows.map((r) => ({ ...r, got: r[key], split: "test" }));
  const summary = {
    model: process.env.LLM_MODEL || "openai/gpt-4o-mini",
    n: llmRows.length,
    llmStats: llm.stats(),
    rules: groupMetrics(view("rules")),
    rulesPlusLlm: groupMetrics(view("combined")),
    llmAlone: groupMetrics(view("alone"))
  };
  printSummary("LLM subsample: rules only", summary.rules);
  printSummary("LLM subsample: rules + LLM (product behaviour)", summary.rulesPlusLlm);
  printSummary("LLM subsample: LLM alone on every message", summary.llmAlone);
  console.log("llm calls", JSON.stringify(llm.stats()));
  const ltag = "llm-v" + atoms.RULES_VERSION;
  writeFileSync(path.join(resultsDir, ltag + ".json"), JSON.stringify({ ...summary, at: new Date().toISOString(), rows: llmRows }, null, 1) + "\n");
  writeFileSync(path.join(localDir, ltag + ".local.json"), JSON.stringify(localLlm, null, 1));
  console.log("wrote results/" + ltag + ".json");
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
