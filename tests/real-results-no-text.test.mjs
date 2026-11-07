import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// eval/real/results/ is tracked. It may hold ids, labels, verdicts and counts, never
// dataset message text (evidence spans quote it). Those stay in gitignored eval/real/.data/.
const dir = path.join(import.meta.dirname, "..", "eval", "real", "results");
const TEXT_KEYS = ["evidence", "text", "aloneEvidence"];

test("tracked real-eval results carry no message text", () => {
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    for (const row of Array.isArray(data.rows) ? data.rows : []) {
      for (const key of TEXT_KEYS) {
        assert.ok(!(key in row), `${name}: row ${row.id} has a "${key}" field`);
      }
    }
  }
});
