// Builds hosted/public for the Cloudflare Worker: the demo pages plus a start page.
// Mock mode only. Run: npm run hosted:build (deploy: npm run hosted:deploy).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "hosted", "public");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "demo"), { recursive: true });
for (const name of fs.readdirSync(path.join(root, "demo"))) {
  if (!name.endsWith(".html")) continue;
  // Workers assets send text/html without a charset, so declare it up front.
  // Also tell crawlers to stay away (the _headers file sends X-Robots-Tag too).
  let html = fs.readFileSync(path.join(root, "demo", name), "utf8");
  const head = '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">';
  html = html.replace(/<head>/i, (m) => m + "\n" + head);
  fs.writeFileSync(path.join(out, "demo", name), html);
}
for (const name of fs.readdirSync(path.join(root, "hosted", "static"))) {
  fs.copyFileSync(path.join(root, "hosted", "static", name), path.join(out, name));
}
console.log("built " + path.relative(root, out));
