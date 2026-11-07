import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

function credSpan(text, span) {
  return findAtoms(text).some((hit) => hit.atom === "credential_request" && hit.text === span);
}

test("Danish definite sikkerhedskoden, adgangskoden, and kortnummeret are credential asks", async () => {
  const security = "Send mig sikkerhedskoden fra sms, så jeg kan betale i dag.";
  const securityResult = await detect(security);
  assert.equal(securityResult.kind, "risk");
  assert.equal(securityResult.level, "medium");
  assert.deepEqual(securityResult.signals, ["credential_request"]);
  assert.ok(credSpan(security, "sikkerhedskoden"));

  const securityMuseum = await detect("Sikkerhedskoden til museet kom i går med posten.");
  assert.equal(securityMuseum.kind, "silent");
  assert.equal(securityMuseum.silentReason, "no_atom");
  assert.deepEqual(securityMuseum.signals, []);

  const access = "Send mig adgangskoden fra sms, så jeg kan betale i dag.";
  const accessResult = await detect(access);
  assert.equal(accessResult.kind, "risk");
  assert.equal(accessResult.level, "medium");
  assert.deepEqual(accessResult.signals, ["credential_request"]);
  assert.ok(credSpan(access, "adgangskoden"));

  const accessMuseum = await detect("Adgangskoden til museet kom i går med posten.");
  assert.equal(accessMuseum.kind, "silent");
  assert.equal(accessMuseum.silentReason, "no_atom");
  assert.deepEqual(accessMuseum.signals, []);

  const card = "Send mig kortnummeret, så jeg kan betale i dag.";
  const cardResult = await detect(card);
  assert.equal(cardResult.kind, "risk");
  assert.equal(cardResult.level, "medium");
  assert.deepEqual(cardResult.signals, ["credential_request"]);
  assert.ok(credSpan(card, "kortnummeret"));

  const code = "Send mig koden fra sms, så jeg kan betale i dag.";
  const codeResult = await detect(code);
  assert.equal(codeResult.kind, "risk");
  assert.equal(codeResult.level, "medium");
  assert.deepEqual(codeResult.signals, ["credential_request"]);
  assert.ok(credSpan(code, "koden"));

  const once = "Send mig engangskoden fra sms, så jeg kan betale i dag.";
  const onceResult = await detect(once);
  assert.equal(onceResult.kind, "risk");
  assert.equal(onceResult.level, "medium");
  assert.deepEqual(onceResult.signals, ["credential_request"]);
  assert.ok(credSpan(once, "engangskoden"));

  const confirm = "Send mig bekræftelseskoden fra sms, så jeg kan betale i dag.";
  const confirmResult = await detect(confirm);
  assert.equal(confirmResult.kind, "risk");
  assert.equal(confirmResult.level, "medium");
  assert.deepEqual(confirmResult.signals, ["credential_request"]);
  assert.ok(credSpan(confirm, "bekræftelseskoden"));

  const pin = "Send mig pinkoden fra kortet, så jeg kan betale i dag.";
  const pinResult = await detect(pin);
  assert.equal(pinResult.kind, "risk");
  assert.equal(pinResult.level, "medium");
  assert.deepEqual(pinResult.signals, ["credential_request"]);
  assert.ok(credSpan(pin, "pinkoden"));
});
