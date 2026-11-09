// Refresh the marketplace-case rows in model-results.json from the shipped weights, without training.
// Use this when eval/cases/pay-risk.json or the rules change; train-model.mjs always refits the model.
// Never writes extension/lib/scam-model-weights.js. Touches only rows.cases and marketplaceCases.
//
//   npm run rescore:model
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { payRisk, atoms, scamModel } from "../../extension/lib/index.js";

const root = new URL("../../", import.meta.url);
const resultsUrl = new URL("research/chat-scams/model-results.json", root);
const results = JSON.parse(readFileSync(resultsUrl, "utf8"));
const { cases } = JSON.parse(readFileSync(new URL("eval/cases/pay-risk.json", root), "utf8"));

const { version, threshold } = scamModel.info();
if (version !== results.version || threshold !== results.threshold) {
  throw new Error(`weights ${version}@${threshold} do not match results ${results.version}@${results.threshold}`);
}

const rows = [];
for (const c of cases) {
  const raw = c.messages.map((m) => m.text).join("\n");
  const v = await payRisk.detect(raw, { ...c.context, messages: c.messages });
  // No counterparty text: the browser returns null, the trainer records 0.
  const scored = scamModel.score(raw, { messages: c.messages });
  rows.push({ id: c.id, lang: c.lang, y: c.expect === "risk" ? 1 : 0, rules: v.kind === "risk" ? "risk" : v.silentReason, p: scored ? scored.p : 0 });
}

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function mets(list, pred) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of list) {
    const s = pred(r);
    if (r.y && s) tp++;
    else if (!r.y && s) fp++;
    else if (r.y) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { n: list.length, tp, fp, fn, tn, precision: r3(precision), recall: r3(recall), f1: r3(f1), fpr: r3(fp + tn ? fp / (fp + tn) : null) };
}
const addable = (r) => r.rules === "no_atom" || r.rules === "weak_only";
const policies = {
  rules: (r) => r.rules === "risk",
  model: (r) => r.p >= threshold,
  rules_or_model: (r) => r.rules === "risk" || (addable(r) && r.p >= threshold)
};
const report = (list) => Object.fromEntries(Object.entries(policies).map(([name, pred]) => [name, mets(list, pred)]));

results.marketplaceCases = { all: report(rows), da: report(rows.filter((r) => r.lang === "da")), en: report(rows.filter((r) => r.lang === "en")) };
results.rows.cases = rows.map((r) => ({ id: r.id, y: r.y, rules: r.rules, p: Math.round(r.p * 1e4) / 1e4 }));
results.casesRescored = { rulesVersion: atoms.RULES_VERSION, cases: rows.length };

writeFileSync(fileURLToPath(resultsUrl), JSON.stringify(results, null, 1) + "\n");
console.log(`rescored ${rows.length} cases with ${version}`, JSON.stringify(results.marketplaceCases.all));
