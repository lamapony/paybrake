import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { score, maybeScore, tokenize, ML_SCORER_ENABLED } from "../extension/lib/ml-scorer.js";

const model = JSON.parse(readFileSync(new URL("../ml/model.json", import.meta.url)));
const ref = JSON.parse(readFileSync(new URL("./fixtures-ml-ref.json", import.meta.url)));

test("flag is off by default and maybeScore returns null", () => {
  assert.equal(ML_SCORER_ENABLED, false);
  assert.equal(maybeScore(model, "send deposit"), null);
});

test("tokenizer lowercases, splits unicode, adds bigrams", () => {
  assert.deepEqual(tokenize("Send ØRE_now"), ["send", "øre", "now", "send øre", "øre now"]);
});

test("JS score matches sklearn predict_proba", () => {
  for (const r of ref) assert.ok(Math.abs(score(model, r.text).score - r.p) < 1e-3, r.text.slice(0, 40));
});

test("score is in [0,1] and warn follows threshold", () => {
  const r = score(model, "");
  assert.ok(r.score > 0 && r.score < 1);
  assert.equal(r.warn, r.score >= model.threshold);
});

test("char_wb n-grams match sklearn semantics", async () => {
  const { charNgrams } = await import("../extension/lib/ml-scorer.js");
  assert.deepEqual(charNgrams("Hi  Ø", 2, 3), [" h", "hi", "i ", " hi", "hi ", " ø", "ø ", " ø "]);
  assert.deepEqual(charNgrams("a", 2, 4), [" a", "a ", " a "]);
});
