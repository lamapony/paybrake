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
// /promo lets a visitor run the extension's real rules in the tab, so the page needs these files. Loaded on demand.
const promoLib = path.join(out, "promo", "lib");
fs.mkdirSync(promoLib, { recursive: true });
for (const name of ["brand", "tidy", "atoms", "extract", "redact", "pay-risk"]) {
  fs.copyFileSync(path.join(root, "extension", "lib", `${name}.js`), path.join(promoLib, `${name}.js`));
}
// The playground stays hidden unless this attribute names the copied files (it is empty in hosted/static).
const promoPage = path.join(out, "promo", "index.html");
fs.writeFileSync(promoPage, fs.readFileSync(promoPage, "utf8").replace('data-rules-lib=""', 'data-rules-lib="lib/"'));
execFileSync(process.execPath, [path.join(root, "scripts", "pack-extension.mjs")], { stdio: "inherit" });
fs.copyFileSync(path.join(root, "dist", "paybrake-extension.zip"), path.join(out, "paybrake-extension.zip"));
console.log("built " + path.relative(root, out));
