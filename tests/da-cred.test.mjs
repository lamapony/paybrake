import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

test("Danish bekræftelseskoden and pinkoden are credential asks", async () => {
  const confirm = "Send mig bekræftelseskoden fra sms, så jeg kan betale i dag.";
  const confirmResult = await detect(confirm);
  assert.equal(confirmResult.kind, "risk");
  assert.equal(confirmResult.level, "medium");
  assert.deepEqual(confirmResult.signals, ["credential_request"]);
  assert.ok(findAtoms(confirm).some((hit) => hit.atom === "credential_request" && hit.text === "bekræftelseskoden"));

  const museum = await detect("Bekræftelseskoden til museet kom i går med posten.");
  assert.equal(museum.kind, "silent");
  assert.equal(museum.silentReason, "no_atom");
  assert.deepEqual(museum.signals, []);

  const kode = "Send mig koden fra sms, så jeg kan betale i dag.";
  const kodeResult = await detect(kode);
  assert.equal(kodeResult.kind, "risk");
  assert.equal(kodeResult.level, "medium");
  assert.deepEqual(kodeResult.signals, ["credential_request"]);
  assert.ok(findAtoms(kode).some((hit) => hit.atom === "credential_request" && hit.text === "koden"));

  const once = "Send mig engangskoden fra sms, så jeg kan betale i dag.";
  const onceResult = await detect(once);
  assert.equal(onceResult.kind, "risk");
  assert.equal(onceResult.level, "medium");
  assert.deepEqual(onceResult.signals, ["credential_request"]);
  assert.ok(findAtoms(once).some((hit) => hit.text === "engangskoden"));

  const pin = "Send mig pinkoden fra kortet, så jeg kan betale i dag.";
  const pinResult = await detect(pin);
  assert.equal(pinResult.kind, "risk");
  assert.equal(pinResult.level, "medium");
  assert.deepEqual(pinResult.signals, ["credential_request"]);
  assert.ok(findAtoms(pin).some((hit) => hit.atom === "credential_request" && hit.text === "pinkoden"));

  const english = "Send me the PIN code from the card so I can pay today.";
  const englishResult = await detect(english);
  assert.equal(englishResult.kind, "risk");
  assert.equal(englishResult.level, "medium");
  assert.deepEqual(englishResult.signals, ["credential_request"]);
  assert.ok(findAtoms(english).some((hit) => hit.atom === "credential_request" && /PIN code/i.test(hit.text)));

  const coat = await detect("The pink coat is on the chair in the hall today.");
  assert.equal(coat.kind, "silent");
  assert.equal(coat.silentReason, "no_atom");
  assert.deepEqual(coat.signals, []);

  const locker = await detect("The PIN for the museum locker is on the ticket from yesterday.");
  assert.equal(locker.kind, "silent");
  assert.equal(locker.silentReason, "no_atom");
  assert.deepEqual(locker.signals, []);
});
