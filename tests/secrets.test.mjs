import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// "sk-" must start a token: Danish and Norwegian words end in "sk"
// (falsk-, dansk-, norsk-), so a bare "sk-" also fires inside chat ids
// like "ho-da-falsk-betalingsbillede". Key bodies may hold "-" and "_"
// so "sk-proj-..." style keys are caught too.
const pattern = [
  "(^|[^A-Za-z0-9])" + "sk-" + "[A-Za-z0-9_-]{10,}",
  "EA" + "AG",
  "A21" + "AA",
  "client_secret[[:space:]]*[:=][[:space:]]*['\\\"][^'\\\"]+"
].join("|");

function grep(args, cwd) {
  return spawnSync("git", ["grep", ...args, "-nE", pattern, "--", "."], {
    cwd,
    encoding: "utf8"
  });
}

test("tracked files contain no secret-shaped strings", () => {
  const result = grep([], root);
  assert.equal(result.status, 1, result.stdout || result.stderr || "git grep failed");
  assert.equal((result.stdout || "").trim(), "");
});

test("the secret scan flags key shapes and ignores Danish words ending in sk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-secrets-"));
  try {
    const write = (name, text) => fs.writeFileSync(path.join(dir, name), text + "\n");
    const scan = () => grep(["--no-index"], dir);

    write("chat.jsonl", '{"id":"ho-da-falsk-betalingsbillede","lang":"da"}');
    write("words.txt", "dansk-oversaettelse norsk-tekstbehandling risk-assessment12");
    let result = scan();
    assert.equal(result.status, 1, result.stdout || result.stderr);

    const cases = {
      "plain.env": "OPENAI_KEY=" + "sk-" + "abcdefghij0123456789",
      "proj.env": "key: " + "sk-" + "proj-" + "abcdefghij_0123456789",
      "line-start.txt": "sk-" + "ABCDEFGHIJKLMNOP",
      "meta.txt": "token " + "EA" + "AG" + "xyz",
      "paypal.txt": "A21" + "AA" + "xyz",
      "config.js": "client_secret" + ': "' + "hunter2" + '"'
    };
    for (const [name, text] of Object.entries(cases)) {
      write(name, text);
      result = scan();
      assert.equal(result.status, 0, `${name} should be flagged: ${result.stderr}`);
      assert.match(result.stdout, new RegExp("^" + name.replace(".", "\\.") + ":", "m"));
      fs.rmSync(path.join(dir, name));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
