// Shared metric helpers for the real-message eval.

const argv = process.argv.slice(2);
const flag = (name) => argv.includes("--" + name);

export function metrics(rows) {
  const tp = rows.filter((r) => r.label === "scam" && r.got === "risk").length;
  const fp = rows.filter((r) => r.label === "legit" && r.got === "risk").length;
  const fn = rows.filter((r) => r.label === "scam" && r.got !== "risk").length;
  const tn = rows.filter((r) => r.label === "legit" && r.got !== "risk").length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  const fpr = fp + tn ? fp / (fp + tn) : null;
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return { n: rows.length, tp, fp, fn, tn, precision: r3(precision), recall: r3(recall), f1: r3(f1), fpr: r3(fpr) };
}

export function groupMetrics(rows) {
  const out = {};
  const datasets = [...new Set(rows.map((r) => r.dataset))];
  for (const ds of datasets) {
    const d = rows.filter((r) => r.dataset === ds);
    out[ds] = {
      all: metrics(d),
      dev: metrics(d.filter((r) => r.split === "dev")),
      test: metrics(d.filter((r) => r.split === "test"))
    };
    const sub = {};
    for (const st of [...new Set(d.map((r) => r.subtype))]) {
      const s = d.filter((r) => r.subtype === st);
      sub[st] = { label: s[0].label, n: s.length, flagged: s.filter((r) => r.got === "risk").length };
    }
    out[ds].bySubtype = sub;
    const pay = d.filter((r) => r.payAsk === true);
    if (pay.length) out[ds].payAskScams = { n: pay.length, flagged: pay.filter((r) => r.got === "risk").length };
  }
  out.pooled = { all: metrics(rows), dev: metrics(rows.filter((r) => r.split === "dev")), test: metrics(rows.filter((r) => r.split === "test")) };
  return out;
}

export function printSummary(title, g) {
  console.log("\n== " + title);
  console.log("dataset          split  n     tp   fp   fn   tn    prec   rec    f1     fpr");
  for (const [ds, m] of Object.entries(g)) {
    // Tuning runs print dev only; pass --report to see the test split.
    for (const split of flag("report") ? ["all", "dev", "test"] : ["dev"]) {
      const x = m[split];
      if (!x) continue;
      console.log(
        [ds.padEnd(16), split.padEnd(6), String(x.n).padEnd(5), String(x.tp).padEnd(4), String(x.fp).padEnd(4), String(x.fn).padEnd(4), String(x.tn).padEnd(5),
          String(x.precision).padEnd(6), String(x.recall).padEnd(6), String(x.f1).padEnd(6), String(x.fpr)].join(" ")
      );
    }
  }
}

