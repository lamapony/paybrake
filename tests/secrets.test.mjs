import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("tracked files contain no secret-shaped strings", () => {
  const pattern = [
    "sk-" + "[A-Za-z0-9]{10,}",
    "EA" + "AG",
    "A21" + "AA",
    "client_secret\\s*[:=]\\s*['\\\"][^'\\\"]+"
  ].join("|");
  const result = spawnSync("git", ["grep", "-nE", pattern, "--", "."], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 1, result.stdout || result.stderr || "git grep failed");
  assert.equal((result.stdout || "").trim(), "");
});
