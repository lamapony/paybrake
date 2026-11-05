const DEFAULT_BACKEND = globalThis.pbConfig.DEFAULT_BACKEND;

function $(id) {
  return document.getElementById(id);
}

function formatEntry(entry) {
  const when = new Date(entry.ts || Date.now()).toISOString();
  const signals = Array.isArray(entry.signals) ? entry.signals.join(", ") : "";
  return when + " · " + (entry.action || "mark") + (entry.level ? " · " + entry.level : "") + (signals ? " · " + signals : "");
}

async function readLog() {
  const stored = await chrome.storage.local.get("pb_log");
  return Array.isArray(stored.pb_log) ? stored.pb_log : [];
}

function renderLog(entries) {
  const list = $("log");
  const empty = $("empty");
  list.replaceChildren();
  const shown = entries.filter((entry) => entry && (entry.action === "override" || entry.action === "protect" || entry.action === "mark" || entry.action === "miss"));
  empty.hidden = shown.length > 0;
  for (const entry of shown.slice().reverse()) {
    const item = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatEntry(entry);
    const head = document.createElement("div");
    head.textContent = entry.head || entry.hash || "";
    item.append(meta, head);
    list.append(item);
  }
}

async function load() {
  const stored = await chrome.storage.local.get("pb_opts");
  const opts = stored.pb_opts || {};
  $("backend").value = opts.backendUrl || DEFAULT_BACKEND;
  // Demo build: the AI check on all chats is ON unless the user turned it off.
  $("aiAll").checked = typeof opts.aiAll === "boolean" ? opts.aiAll : true;
  $("localModel").checked = typeof opts.localModel === "boolean" ? opts.localModel : true;
  $("debug").checked = Boolean(opts.debug);
  renderLog(await readLog());
  showAiStatus($("backend").value);
}

async function showAiStatus(backendUrl) {
  const out = $("ai-status");
  const base = String(backendUrl || DEFAULT_BACKEND).replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(base + "/health", { signal: ctrl.signal });
    const info = await res.json();
    if (info && info.llm === "configured") {
      out.textContent = "This server: AI check ready (" + String(info.llmProvider || "AI provider") + ").";
    } else {
      out.textContent = "This server has no AI provider (mock mode): the AI check is off here and only the rules run. Nothing is sent.";
    }
  } catch {
    out.textContent = "Could not reach this server. Cards will say \"AI check unavailable\" and use rules only.";
  } finally {
    clearTimeout(timer);
  }
}

$("opts").addEventListener("submit", async (event) => {
  event.preventDefault();
  const backendUrl = $("backend").value.trim() || DEFAULT_BACKEND;
  await chrome.storage.local.set({
    pb_opts: {
      backendUrl,
      aiAll: $("aiAll").checked,
      localModel: $("localModel").checked,
      debug: $("debug").checked
    }
  });
  $("saved").textContent = "Saved";
  showAiStatus(backendUrl);
});

function pick(url) {
  $("backend").value = url;
  $("saved").textContent = "Press Save to keep this";
}
$("use-hosted").addEventListener("click", () => pick(globalThis.pbConfig.HOSTED_BACKEND));
$("use-local").addEventListener("click", () => pick(globalThis.pbConfig.LOCAL_BACKEND));

$("download").addEventListener("click", async () => {
  const entries = await readLog();
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "paybrake-overrides.json";
  link.click();
  URL.revokeObjectURL(url);
});

$("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ pb_log: [] });
  renderLog([]);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.pb_log) renderLog(changes.pb_log.newValue || []);
});

load();
