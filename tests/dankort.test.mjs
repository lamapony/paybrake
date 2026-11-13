import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("dankortnummeret with a request verb is a medium credential ask", async () => {
  const asks = [
    "Send mig dankortnummeret, så jeg kan betale i dag.",
    "Send mig dankortnummeret fra sms, så jeg kan betale i dag."
  ];
  for (const text of asks) {
    const verdict = await detect(text);
    assert.equal(verdict.kind, "risk", text);
    assert.equal(verdict.level, "medium", text);
    assert.deepEqual(verdict.signals, ["credential_request"], text);
    assert.equal(verdict.rulesVersion, 5, text);
    assert.ok(
      verdict.evidence.some((hit) => hit.atom === "credential_request" && hit.text === "dankortnummeret"),
      text
    );
    assert.ok(
      findAtoms(text).some((hit) => hit.atom === "credential_request" && hit.text === "dankortnummeret" && hit.gate === "cred"),
      text
    );
  }
});

test("a museum dankortnummeret without a request verb stays silent", async () => {
  const text = "Dankortnummeret til museet kom i går med posten.";
  const verdict = await detect(text);
  assert.equal(verdict.kind, "silent");
  assert.equal(verdict.silentReason, "no_atom");
  assert.deepEqual(verdict.signals, []);
  assert.deepEqual(verdict.evidence, []);
  assert.equal(findAtoms(text).some((hit) => hit.atom === "credential_request"), false);
});

test("kortnummeret stays a medium credential ask, and the dankort lamp stays a veto", async () => {
  const card = "Send mig kortnummeret, så jeg kan betale i dag.";
  const verdict = await detect(card);
  assert.equal(verdict.kind, "risk");
  assert.equal(verdict.level, "medium");
  assert.deepEqual(verdict.signals, ["credential_request"]);
  assert.ok(verdict.evidence.some((hit) => hit.atom === "credential_request" && hit.text === "kortnummeret"));
  assert.ok(findAtoms(card).some((hit) => hit.atom === "credential_request" && hit.text === "kortnummeret" && hit.gate === "cred"));

  const lampText = "The dankort lamp is ready when you pick it up.";
  const lamp = await detect(lampText);
  assert.equal(lamp.kind, "silent");
  assert.equal(lamp.silentReason, "veto");
  assert.deepEqual(lamp.signals, []);
  assert.deepEqual(lamp.evidence, []);
  assert.equal(findAtoms(lampText).some((hit) => hit.atom === "credential_request"), false);
  assert.ok(findAtoms(lampText).some((hit) => hit.atom === "pay_on_collection"));
});
