import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { payRisk } from "../extension/lib/index.js";

const messages = JSON.parse(fs.readFileSync(new URL("../night/messages.json", import.meta.url)));
const expected = ["high", "medium", "high", "medium", "medium", "high", "high", "high", "silent"];
test("roleplay messages have the expected rules-only levels", async () => {
  for (const [i, message] of messages.entries()) {
    const result = await payRisk.detect(message);
    assert.equal(result.kind === "silent" ? "silent" : result.level, expected[i], `message ${i + 1}`);
  }
});
