// "AI check on all chats" eval: rules v3 + LLM asked on every chat (llmMode "all").
//
//   OPENROUTER_API_KEY=... node eval/real/run-llm-all.mjs --split=dev  [--n=all|200] [--concurrency=6]
//   OPENROUTER_API_KEY=... node eval/real/run-llm-all.mjs --split=test --n=200 --report
//
// Model answers are cached in eval/real/.data/llm-cache.json (keyed by model + prompt + the
// redacted transcript), so threshold sweeps and reruns cost nothing. Threshold tuning
// (--sweep) is only allowed on the dev split. Writes results/llm-all-v<RULES>-<split>-<n>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payRisk, atoms } from "../../extension/lib/index.js";
import { classifyText, SYSTEM } from "../../backend/src/classify.js";
import { loadAll } from "./load.mjs";
import { sampleBalanced, mulberry32, shuffle } from "./sample.mjs";
import { metrics, groupMetrics, printSummary } from "./metrics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261026;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes("--" + name);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const split = opt("split", "dev");
const nOpt = opt("n", "all");
const concurrency = Number(opt("concurrency", "6"));
const model = process.env.LLM_MODEL || "openai/gpt-4o-mini";
const cachePath = path.join(here, ".data", "llm-cache.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
let fresh = 0;
let failures = 0;
const failureCodes = {};

function keyOf(text) {
  return createHash("sha256").update(model + "\n" + SYSTEM + "\n" + text).digest("hex");
}

async function cachedAsk(payload) {
  const text = String(payload.text);
  const key = keyOf(text);
  if (!cache[key]) {
    const t0 = Date.now();
    try {
      const out = await classifyText(text, process.env);
      cache[key] = { out, ms: Date.now() - t0 };
    } catch (e) {
      failures++;
      const code = String(e.message || e.code || "error").slice(0, 40);
      failureCodes[code] = (failureCodes[code] || 0) + 1;
      // Do not cache failures: a rerun retries them.
      if (fresh === 0 && failures >= 5) throw Object.assign(new Error("first calls all failed: " + (e.code || e.message)), { fatal: true });
      throw e;
    }
    fresh++;
    if (fresh % 50 === 0) writeFileSync(cachePath, JSON.stringify(cache));
  }
  return cache[key].out;
}

function textOf(item) {
  return item.messages.map((m) => m.text).join("\n");
}

function pick(sample) {
  const pool = sample.filter((s) => s.split === split);
  if (nOpt === "all") return pool;
  const n = Number(nOpt);
  // Same stratified draw as run-real.mjs --llm (equal share per dataset x label), so the
  // test-200 subsample is the very same 200 messages as the v1/v2 LLM runs.
  const strata = [...new Set(pool.map((s) => s.dataset + "|" + s.label))];
  const per = Math.floor(n / strata.length);
  const rand = mulberry32(SEED + 7);
  return strata.flatMap((k) => shuffle(pool.filter((s) => s.dataset + "|" + s.label === k), rand).slice(0, per));
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

async function evaluate(items, cfg, ask) {
  return pool(items, async (item) => {
    const rules = await payRisk.detect(textOf(item), { messages: item.messages });
    const v = await payRisk.detect(textOf(item), { messages: item.messages }, { askLlm: ask, llmMode: "all", timeoutMs: 30000, ...cfg });
    return {
      id: item.id, dataset: item.dataset, split: item.split, label: item.label, subtype: item.subtype, payAsk: item.payAsk,
      rules: rules.kind === "risk" ? "risk" : "silent",
      got: v.kind === "risk" ? "risk" : "silent",
      llm: v.llm,
      alone: v.ai && v.ai.risky ? "risk" : "silent",
      aiConfidence: v.ai ? v.ai.confidence : null,
      aiSignal: v.ai ? v.ai.signal : null,
      signals: v.signals
    };
  });
}

function pct(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function main() {
  const sample = sampleBalanced(loadAll(), { seed: SEED, cap: 500 });
  const items = pick(sample);
  console.log(`split=${split} n=${items.length} model=${model} cached=${Object.keys(cache).length}`);
  const t0 = Date.now();
  let rows;
  try {
    rows = await evaluate(items, {}, cachedAsk);
  } finally {
    writeFileSync(cachePath, JSON.stringify(cache));
  }
  const wall = Date.now() - t0;
  const errs = rows.filter((r) => r.llm === "unavailable").length;
  if (fresh === 0 && failures >= 5) throw new Error("LLM unreachable");

  const view = (key) => rows.map((r) => ({ ...r, got: r[key] }));
  const summary = {
    model, split, n: rows.length, rulesVersion: atoms.RULES_VERSION, seed: SEED,
    thresholds: payRisk.DEFAULTS,
    llm: {
      freshCalls: fresh, failures, failureCodes, unavailableRows: errs, wallMs: wall, concurrency,
      latencyMs: (() => {
        const ms = items.map((it) => {
          const t = payRisk.transcriptOf(it.messages.map((m) => ({ from: m.from, text: m.text }))).text;
          return cache[keyOf(t)] && cache[keyOf(t)].ms;
        }).filter((x) => typeof x === "number");
        return { n: ms.length, p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: pct(ms, 1) };
      })()
    },
    rulesOnly: groupMetrics(view("rules")),
    rulesPlusLlmAll: groupMetrics(view("got")),
    llmAlone: groupMetrics(view("alone")),
    llmStates: rows.reduce((acc, r) => ((acc[r.llm] = (acc[r.llm] || 0) + 1), acc), {})
  };

  if (flag("sweep")) {
    if (split !== "dev") throw new Error("--sweep is only allowed on the dev split");
    const grid = [];
    for (const downgradeConfidence of [0.7, 0.8, 0.85, 0.9, 0.95, 1.01]) {
      for (const addConfidence of [0, 0.5, 0.7, 0.8, 0.9]) {
        const r = await evaluate(items, { downgradeConfidence, addConfidence }, cachedAsk);
        grid.push({ downgradeConfidence, addConfidence, ...metrics(r) });
      }
    }
    summary.sweep = grid;
    console.log("\nsweep (dev): downgrade add -> P R F1 FPR");
    for (const g of grid) console.log(g.downgradeConfidence, g.addConfidence, "->", g.precision, g.recall, g.f1, g.fpr);
  }


  for (const [t, g] of [["rules only (v" + atoms.RULES_VERSION + ")", summary.rulesOnly], ["rules + LLM on all chats", summary.rulesPlusLlmAll], ["LLM alone", summary.llmAlone]]) {
    console.log("\n== " + t + " [" + split + "]");
    for (const [ds, m] of Object.entries(g)) {
      const x = m[split];
      console.log(ds.padEnd(16), String(x.n).padEnd(5), "tp", x.tp, "fp", x.fp, "fn", x.fn, "tn", x.tn, "P", x.precision, "R", x.recall, "F1", x.f1, "FPR", x.fpr);
    }
  }

  console.log("\nllm", JSON.stringify(summary.llm), JSON.stringify(summary.llmStates));
  const dir = path.join(here, "results");
  mkdirSync(dir, { recursive: true });
  const tag = `llm-all-v${atoms.RULES_VERSION}-${split}-${nOpt}`;
  writeFileSync(path.join(dir, tag + ".json"), JSON.stringify({ ...summary, at: new Date().toISOString(), rows }, null, 1) + "\n");
  console.log("wrote results/" + tag + ".json");
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
