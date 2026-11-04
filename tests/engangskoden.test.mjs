import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Danish definite engangskoden is a credential ask", async () => {
  const text = "Send mig engangskoden fra sms, så jeg kan betale i dag.";
  const result = await detect(text);
  assert.equal(result.kind, "risk");
  assert.equal(result.level, "medium");
  assert.deepEqual(result.signals, ["credential_request"]);
  assert.ok(findAtoms(text).some((hit) => hit.atom === "credential_request" && hit.text === "engangskoden"));
});

test("engangskode and koden fra sms stay risk", async () => {
  const indefinite = "Send mig engangskode fra sms, så jeg kan betale i dag.";
  const indefiniteResult = await detect(indefinite);
  assert.equal(indefiniteResult.kind, "risk");
  assert.equal(indefiniteResult.level, "medium");
  assert.deepEqual(indefiniteResult.signals, ["credential_request"]);
  assert.ok(findAtoms(indefinite).some((hit) => hit.text === "engangskode"));

  const kode = "Send mig koden fra sms, så jeg kan betale i dag.";
  const kodeResult = await detect(kode);
  assert.equal(kodeResult.kind, "risk");
  assert.equal(kodeResult.level, "medium");
  assert.deepEqual(kodeResult.signals, ["credential_request"]);
  assert.ok(findAtoms(kode).some((hit) => hit.atom === "credential_request" && hit.text === "koden"));
});
