// Screenshot of the real Chrome toolbar with PayBrake pinned (headed Chromium on a virtual display).
// Needs Xvfb + ffmpeg. Run: xvfb-run -a -s "-screen 0 1280x800x24" node tests/e2e/toolbar-shot.cjs
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright-core")); } catch { ({ chromium } = require("/home/box/.local/lib/node_modules/playwright-core")); }

const root = path.resolve(__dirname, "..", "..");
const zip = path.join(root, "dist", "paybrake-extension.zip");
const out = path.join(root, "shots", process.env.PB_SHOTS || "tester-v2", "00-toolbar-icon-1280.png");
const chrome = "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";

function unpackedId(dir) {
  const hex = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-toolbar-"));
  execFileSync("unzip", ["-q", zip, "-d", tmp]);
  const ext = path.join(tmp, "paybrake-extension");
  const profile = path.join(tmp, "profile");
  fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
  fs.writeFileSync(path.join(profile, "Default", "Preferences"), JSON.stringify({ extensions: { pinned_extensions: [unpackedId(ext)] } }));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, executablePath: chrome, viewport: null,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-position=0,0", "--window-size=1280,800", "--no-first-run"]
  });
  try {
    let welcome = null;
    for (let i = 0; i < 150 && !welcome; i++) {
      welcome = ctx.pages().find((p) => /welcome\.html$/.test(p.url())) || null;
      if (!welcome) await new Promise((r) => setTimeout(r, 100));
    }
    for (const p of ctx.pages()) if (p !== welcome) await p.close().catch(() => {});
    await welcome.bringToFront();
    await new Promise((r) => setTimeout(r, 2500));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1280x800", "-i", process.env.DISPLAY, "-frames:v", "1", out]);
    console.log("shot " + path.relative(root, out));
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
