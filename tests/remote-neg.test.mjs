import test from "node:test";
import assert from "node:assert/strict";
import { atoms, payRisk } from "../extension/lib/index.js";

const { detect } = payRisk;
const { findAtoms } = atoms;

async function silent(text) {
  const hits = findAtoms(text);
  assert.equal(hits.some((hit) => hit.atom === "remote_access"), false, JSON.stringify(hits));
  const result = await detect(text);
  assert.equal(result.kind, "silent");
  assert.equal(result.silentReason, "no_atom");
  assert.deepEqual(result.signals, []);
}

async function risk(text) {
  const result = await detect(text);
  assert.equal(result.kind, "risk");
  assert.equal(result.level, "medium");
  assert.deepEqual(result.signals, ["remote_access"]);
  assert.ok(findAtoms(text).some((hit) => hit.atom === "remote_access"));
}

test("refusing to install AnyDesk is silent", async () => {
  await silent("Do not install AnyDesk. The lamp is ready for pickup on Thursday.");
  await silent("Don't download TeamViewer, the lamp is ready on Thursday.");
});

test("ordinary quick support and quick assist are silent", async () => {
  await silent("The quick support I got from the shop was about the lamp size.");
  await silent("The quick assist I got from the shop was about the lamp size.");
  await silent("The quick support from the shop was about the lamp size only.");
  await silent("I got quick support from the shop about the lamp size yesterday.");
});

test("an AnyDesk download and a bare TeamViewer mention stay where they were", async () => {
  await risk("Download AnyDesk so I can check the payment on your phone.");
  await risk("Please install AnyDesk so our technician can fix your account.");
  await risk("Do not worry and install AnyDesk now.");
  await risk("Install Quick Assist so I can see the lamp on your screen.");
  await risk("Please install QuickSupport so I can see the lamp on your screen.");

  const bare = await detect("TeamViewer");
  assert.equal(bare.kind, "silent");
  assert.equal(bare.silentReason, "short");
  assert.ok(findAtoms("TeamViewer").some((hit) => hit.atom === "remote_access" && hit.text === "TeamViewer"));

  await risk("I mentioned TeamViewer to the shop yesterday afternoon.");
});
