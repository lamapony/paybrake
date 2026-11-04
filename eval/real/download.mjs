// Downloads the pinned Hugging Face files listed in sources.json into eval/real/.data/.
// Usage: node eval/real/download.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, ".data");
const sources = JSON.parse(readFileSync(path.join(here, "sources.json"), "utf8"));

for (const ds of sources.datasets) {
  for (const file of ds.files) {
    const out = path.join(dataDir, ds.key, path.basename(file));
    if (existsSync(out)) {
      console.log("have " + path.relative(here, out));
      continue;
    }
    mkdirSync(path.dirname(out), { recursive: true });
    const url = `https://huggingface.co/datasets/${ds.hf}/resolve/${ds.revision}/${file.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log("got  " + path.relative(here, out));
  }
}
