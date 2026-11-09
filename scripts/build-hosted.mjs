// Builds hosted/public for the Cloudflare Worker: the demo pages, a start page, and the extension zip
// (served at /paybrake-extension.zip so testers and judges need no GitHub access).
// Mock mode only. Run: npm run hosted:build (deploy: npm run hosted:deploy).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "hosted", "public");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "demo"), { recursive: true });
// Only demo pages tracked by git ship: the local QA roleplay harness (untracked) stays off the server.
const tracked = new Set(execFileSync("git", ["ls-files", "demo"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).map((rel) => path.basename(rel)));
for (const name of fs.readdirSync(path.join(root, "demo"))) {
  if (!name.endsWith(".html") || !tracked.has(name)) continue;
  // Workers assets send text/html without a charset, so declare it up front.
  // Also tell crawlers to stay away (the _headers file sends X-Robots-Tag too).
  let html = fs.readFileSync(path.join(root, "demo", name), "utf8");
  const head = '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">\n' +
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">';
  html = html.replace(/<head>/i, (m) => m + "\n" + head);
  fs.writeFileSync(path.join(out, "demo", name), html);
}
// Recursive: hosted/static/promo/ (the promo page and its assets) has subfolders.
fs.cpSync(path.join(root, "hosted", "static"), out, { recursive: true });
execFileSync(process.execPath, [path.join(root, "scripts", "pack-extension.mjs")], { stdio: "inherit" });
fs.copyFileSync(path.join(root, "dist", "paybrake-extension.zip"), path.join(out, "paybrake-extension.zip"));
console.log("built " + path.relative(root, out));
