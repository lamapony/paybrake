// Packs extension/ into dist/paybrake-extension.zip.
// The zip holds one folder, paybrake-extension/, with manifest.json directly inside,
// so after unzipping the tester picks that one folder in "Load unpacked".
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const stage = path.join(dist, "stage");
const folder = path.join(stage, "paybrake-extension");
const zip = path.join(dist, "paybrake-extension.zip");
const SKIP = new Set(["package.json", "node_modules", ".DS_Store", ".gitkeep"]);

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(folder, { recursive: true });
fs.cpSync(path.join(root, "extension"), folder, {
  recursive: true,
  filter: (src) => !SKIP.has(path.basename(src))
});
if (!fs.existsSync(path.join(folder, "manifest.json"))) throw new Error("manifest.json missing from package");
const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
try {
  execFileSync("zip", ["-q", "-r", "-X", zip, "paybrake-extension"], { cwd: stage, stdio: "inherit" });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  // No zip binary: fall back to Python's zipfile.
  const py = "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], 'paybrake-extension')";
  execFileSync("python3", ["-c", py, zip.replace(/\.zip$/, ""), stage], { stdio: "inherit" });
}
fs.rmSync(stage, { recursive: true, force: true });
console.log(`packed ${path.relative(root, zip)} (PayBrake ${manifest.version})`);
