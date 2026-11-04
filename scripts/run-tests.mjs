// `npm test` must not rely on the shell to expand globs.
// Node 20 passes a glob through as a literal path, and Windows cmd does not expand `*`.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dirs = ["tests", "backend/test"];
const files = [];
for (const dir of dirs) {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".mjs")) files.push(`${dir}/${name}`);
  }
}
files.sort();
if (files.length === 0) {
  console.error("no test files under tests/ or backend/test/");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
