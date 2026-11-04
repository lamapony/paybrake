// Loads the pinned datasets from eval/real/.data/ and maps each row into the shape
// PayBrake's detector consumes: { text, messages:[{from,text}], context }.
// Mapping honesty (see eval/real/README.md):
//  - No dataset has a listing title or price, so context is always {} (invented: nothing).
//  - Single messages become one message from the counterparty ("seller" role).
//  - Phone dialogues: caller -> counterparty ("seller"), receiver -> user ("buyer").
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, ".data");

export function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function single(text) {
  return [{ from: "seller", text }];
}

export function splitDialogue(dialogue) {
  const parts = String(dialogue).split(/\b(caller|receiver):\s*/i);
  const messages = [];
  for (let i = 1; i < parts.length; i += 2) {
    const who = parts[i].toLowerCase();
    const body = (parts[i + 1] || "").trim();
    if (!body) continue;
    messages.push({ from: who === "receiver" ? "buyer" : "seller", text: body });
  }
  return messages.length ? messages : single(String(dialogue));
}

// Scam tactics (dataset labels, not our text heuristics) that mean "victim is asked to move money".
const PAY_TACTICS = new Set([
  "payment_redirect",
  "refund_overpayment",
  "courier_customs_fee",
  "romance_advance_fee",
  "family_emergency_impersonation",
  "investment_too_good"
]);

function loadSms() {
  const rows = parseCsv(readFileSync(path.join(dataDir, "sms_spam", "sms-spam-collection.csv"), "utf8"));
  return rows.map((r, i) => ({
    dataset: "sms_spam",
    id: "sms_spam:" + i,
    label: r.label === "spam" ? "scam" : "legit",
    subtype: r.label,
    payAsk: null,
    messages: single(r.message)
  }));
}

function loadDiscord() {
  const rows = parseCsv(readFileSync(path.join(dataDir, "discord", "discord-message-phishing - Sheet1.csv"), "utf8"));
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.lable === "0" || r.lable === "1")
    .map(({ r, i }) => ({
      dataset: "discord",
      id: "discord:" + i,
      label: r.lable === "1" ? "scam" : "legit",
      subtype: r.lable === "1" ? "scam" : "clean",
      payAsk: null,
      messages: single(r.msg_content)
    }));
}

function loadDialogue() {
  const rows = parseCsv(readFileSync(path.join(dataDir, "scam_dialogue", "scam-dialogue_all.csv"), "utf8"));
  return rows.map((r, i) => ({
    dataset: "scam_dialogue",
    id: "scam_dialogue:" + i,
    label: r.label === "1" ? "scam" : "legit",
    subtype: r.type,
    payAsk: null,
    messages: splitDialogue(r.dialogue)
  }));
}

function loadScamGuard() {
  const lines = readFileSync(path.join(dataDir, "scamguardbench", "standard.jsonl"), "utf8").split("\n").filter(Boolean);
  return lines
    .map((line) => JSON.parse(line))
    .filter((r) => r.language === "en")
    .map((r) => ({
      dataset: "scamguardbench",
      id: "scamguardbench:" + r.item_id,
      label: r.verdict === "scam_likely" ? "scam" : "legit",
      subtype: r.verdict === "scam_likely" ? (r.tactics || []).join("+") || "scam" : r.confusable_class || "legit_other",
      tactics: r.tactics || [],
      payAsk: r.verdict === "scam_likely" ? (r.tactics || []).some((t) => PAY_TACTICS.has(t)) : null,
      channel: r.channel,
      messages: single(r.text)
    }));
}

export function loadAll() {
  return [...loadSms(), ...loadDiscord(), ...loadDialogue(), ...loadScamGuard()];
}
