// Offline rules eval, plus a live mode that skips unless /health says the LLM is configured.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payRisk, atoms } from "../extension/lib/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesPath = path.join(root, "eval", "cases", "pay-risk.json");
const reportPath = path.join(root, "eval", "report.json");

function modeFromArgv(argv) {
  const eq = argv.find((arg) => arg.startsWith("--mode="));
  if (eq) return eq.slice("--mode=".length);
  const i = argv.indexOf("--mode");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return "rules";
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function metrics(rows) {
  const tp = rows.filter((row) => row.expect === "risk" && row.got === "risk").length;
  const fp = rows.filter((row) => row.expect === "silent" && row.got === "risk").length;
  const fn = rows.filter((row) => row.expect === "risk" && row.got === "silent").length;
  const tn = rows.filter((row) => row.expect === "silent" && row.got === "silent").length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1, falseAlarms: fp };
}

function pad(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function printTable(rows, totals) {
  console.log(pad("id", 26) + pad("expect", 10) + pad("got", 10) + pad("level", 10) + "signals");
  for (const row of rows) {
    const mark = row.expect === row.got ? " " : "!";
    console.log(
      mark + pad(row.id, 25) + pad(row.expect, 10) + pad(row.got, 10) + pad(row.level || row.silentReason || "", 10) + (row.signals || []).join(",")
    );
  }
  console.log(
    `precision ${round(totals.precision)}  recall ${round(totals.recall)}  f1 ${round(totals.f1)}  false alarms ${totals.falseAlarms}  (tp ${totals.tp} fp ${totals.fp} fn ${totals.fn} tn ${totals.tn})`
  );
}

async function healthSaysLlm(base) {
  try {
    const res = await fetch(base.replace(/\/$/, "") + "/health");
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.llm === "configured";
  } catch {
    return false;
  }
}

async function main() {
  const mode = modeFromArgv(process.argv.slice(2));
  const backend = process.env.PAYBRAKE_BACKEND || "http://127.0.0.1:8787";
  if (mode === "live") {
    const ready = await healthSaysLlm(backend);
    if (!ready) {
      console.log("live mode skipped: backend /health does not report llm configured");
      process.exit(0);
    }
  } else if (mode !== "rules") {
    console.error("unknown mode " + mode);
    process.exit(1);
  }

  const doc = JSON.parse(readFileSync(casesPath, "utf8"));
  const rows = [];
  for (const item of doc.cases) {
    const text = item.messages.map((message) => message.text).join("\n");
    const options = {};
    if (mode === "live") {
      options.askLlm = async (payload) => {
        const res = await fetch(backend.replace(/\/$/, "") + "/api/classify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: payload.text })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const error = new Error((data && data.error) || "classify failed");
          error.status = res.status;
          error.code = data && data.error;
          throw error;
        }
        return data;
      };
    }
    const verdict = await payRisk.detect(text, { ...item.context, messages: item.messages }, options);
    const got = verdict.kind === "risk" ? "risk" : "silent";
    rows.push({
      id: item.id,
      lang: item.lang,
      expect: item.expect,
      got,
      level: verdict.level || null,
      expectLevel: item.level || null,
      silentReason: verdict.silentReason || null,
      signals: verdict.signals || [],
      expectSignals: item.signals || null
    });
  }

  const totals = metrics(rows);
  printTable(rows, totals);
  const report = {
    mode,
    at: new Date().toISOString(),
    rulesVersion: atoms.RULES_VERSION,
    totals: {
      ...totals,
      precision: round(totals.precision),
      recall: round(totals.recall),
      f1: round(totals.f1)
    },
    cases: rows
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log("wrote " + path.relative(root, reportPath));

  if (mode === "rules") {
    const failed = totals.precision < 0.95 || totals.falseAlarms > 0 || totals.recall < 0.8;
    process.exit(failed ? 1 : 0);
  }
  if (totals.precision < 0.95) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
