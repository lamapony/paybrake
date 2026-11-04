// Dev-only experiment (adopted 26 Oct; see RESULTS.md): ask Typesafe extra yes/no questions next to the pinned "risky" one and save the
// raw probabilities, so combinations can be scored offline. Never run on test.
//   node eval/real/exp-typesafe-questions.mjs   (needs TYPESAFE_API_KEY)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payRisk } from "../../extension/lib/index.js";
import { TYPESAFE_RISKY } from "../../backend/src/classify.js";
import { loadAll } from "./load.mjs";
import { sampleBalanced } from "./sample.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, ".data", "exp-typesafe-dev.json");
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("no key");
const T = (t, f) => ({ true: t, false: f });
export const EXTRA = {
  prize: { type: "noul", instructions: "This is one chat or message. Does Them tell the user they have won, been chosen for, or can claim a prize, cash, voucher, holiday, free phone or other reward, or invite them into a paid quiz or draw, and tell them to call, text or reply to a number or short code, or open a link, to get it?",
    criteria: T("Them announces a win, award, selection, free gift or prize draw and tells the user to call, text, reply or click to claim it.", "No prize or reward is claimed, or it is a friend talking about a real win, or a normal shop offer with no claim step.") },
  premium: { type: "noul", instructions: "This is one chat or message. Does Them push the user to call or text a premium-rate number or short code (for example 09..., 087..., 0871..., or a 5-digit short code), or to sign up for a paid text service (ringtones, chat lines, adult content, quizzes) charged to the phone bill?",
    criteria: T("Them asks the user to call or text a premium-rate number or short code, or to subscribe to a paid text service.", "No premium-rate number, short code or paid text service is pushed; normal phone numbers between people.") },
  lure: { type: "noul", instructions: "This is one chat or message. Does Them dangle free Nitro, a giveaway, an airdrop, free crypto or game items, a game, cheat or file to download and test, or access to hidden or private channels, to get the user to click a link, join an invite, scan a QR code or run a file?",
    criteria: T("Them offers something free or exclusive (Nitro, giveaway, airdrop, game to test, cheats, hidden channels) to get the user to click, join, scan or download.", "Normal chat, a real link shared between friends for a clear reason, server rules or moderation, no free bait.") },
  risky2: { type: "noul", instructions: TYPESAFE_RISKY.instructions,
    criteria: T(TYPESAFE_RISKY.criteria.true + " Also: Them claims the user won or can claim a prize, cash, voucher or free phone and tells them to call or text a premium-rate number or short code, or dangles free Nitro, giveaways, airdrops or downloads behind a link.",
      TYPESAFE_RISKY.criteria.false.replace(", plain marketing.", ", plain marketing with no prize claim, premium-rate number or bait link.")) }
};

const sample = sampleBalanced(loadAll(), { seed: 20261026, cap: 500 }).filter((s) => s.split === "dev");
const store = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
let next = 0, done = 0, fails = 0;
async function worker() {
  while (next < sample.length) {
    const item = sample[next++];
    if (store[item.id]) continue;
    const text = payRisk.transcriptOf(item.messages.map((m) => ({ from: m.from, text: m.text }))).text;
    try {
      const res = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model: "jev-1.14.0", state: text, questions: { risky: TYPESAFE_RISKY, ...EXTRA } }),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) { fails++; await res.text(); continue; }
      const a = (await res.json()).answers;
      store[item.id] = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.noul]));
      if (++done % 100 === 0) { writeFileSync(out, JSON.stringify(store)); console.log(done); }
    } catch { fails++; }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
writeFileSync(out, JSON.stringify(store));
console.log("done", done, "fails", fails, "stored", Object.keys(store).length, "of", sample.length);
