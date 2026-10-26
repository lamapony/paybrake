import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const banned = /guarantee|you are protected|100% safe/i;
const brand = /facebook|messenger|meta(?![a-z])|instagram/i;

async function filesUnder(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await filesUnder(full, acc);
    else if (/\.(js|mjs|cjs|html|css|md|json)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

test("copy rule: no promise language in the extension, demo, or README", async () => {
  const starts = ["extension", "demo", "README.md"];
  const hits = [];
  for (const start of starts) {
    const full = path.join(root, start);
    const info = await stat(full);
    const list = info.isDirectory() ? await filesUnder(full) : [full];
    for (const file of list) {
      const text = await readFile(file, "utf8");
      if (banned.test(text)) hits.push(path.relative(root, file));
    }
  }
  assert.deepEqual(hits, []);
});

test("demo pages do not name other social products", async () => {
  const hits = [];
  for (const file of await filesUnder(path.join(root, "demo"))) {
    const text = await readFile(file, "utf8");
    if (brand.test(text)) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, []);
});
