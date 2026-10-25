// Detector unit tests (offline). Run: node --test tests/
// extension/lib/detector.js is a classic script that sets globalThis.PayBrakeDetector
// (so the content script can load it without modules); importing it here runs it once.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../extension/lib/detector.js");
const D = globalThis.PayBrakeDetector;
const { cases } = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));

test("detector API shape", () => {
  assert.equal(typeof D?.detect, "function");
  assert.equal(typeof D?.RULES_VERSION, "number");
});

for (const c of cases) {
  test(`${c.expect}: ${c.id}`, () => {
    const v = D.detect(c.text, { context: c.context || [] });
    assert.equal(v.kind, c.expect, `kind for "${c.text}" -> ${JSON.stringify(v)}`);
    if (c.expect === "silent") {
      assert.equal(typeof v.silentReason, "string");
      return;
    }
    if (c.level) assert.equal(v.level, c.level, `level -> ${JSON.stringify(v)}`);
    for (const s of c.mustHaveSignals || []) assert.ok(v.signals.includes(s), `signal ${s} missing in ${v.signals}`);
    assert.ok(v.reason.length > 0 && v.reason.length <= 160, "one-line reason <= 160 chars");
    assert.ok(!/\n/.test(v.reason), "reason is one line");
    assert.ok(v.evidence.length > 0, "has evidence");
    const all = [...(c.context || []), c.text].join("\n");
    for (const e of v.evidence) assert.ok(all.includes(e.text), `evidence "${e.text}" is verbatim`);
    // The reason quotes at least one evidence span verbatim.
    assert.ok(v.evidence.some((e) => v.reason.includes(e.text)), `reason quotes evidence: ${v.reason}`);
    if (c.amount != null) assert.equal(v.deal.amount, c.amount, `amount -> ${JSON.stringify(v.deal)}`);
    if (c.currency) assert.equal(v.deal.currency, c.currency);
  });
}

test("copy rule: no guarantee language anywhere in the extension", () => {
  const files = ["content.js", "order.html", "order.js", "lib/detector.js"];
  for (const f of files) {
    let src = "";
    try { src = readFileSync(new URL(`../extension/${f}`, import.meta.url), "utf8"); } catch { continue; }
    assert.ok(!/guarantee|you are protected|100% safe/i.test(src), `${f} has forbidden copy`);
  }
});

test("detector is pure: same input, same output; never throws on junk", () => {
  for (const junk of ["", null, undefined, 42, "   ", "€€€ kr kr", "x".repeat(20000)]) {
    assert.doesNotThrow(() => D.detect(junk, { context: [null, 5] }));
  }
  const a = D.detect(cases[0].text, { context: [] });
  const b = D.detect(cases[0].text, { context: [] });
  assert.deepEqual(a, b);
});
