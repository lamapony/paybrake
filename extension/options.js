const DEFAULT_BACKEND = "http://localhost:8787";

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
  $("llm").checked = Boolean(opts.llm);
  $("debug").checked = Boolean(opts.debug);
  renderLog(await readLog());
}

$("opts").addEventListener("submit", async (event) => {
  event.preventDefault();
  const backendUrl = $("backend").value.trim() || DEFAULT_BACKEND;
  await chrome.storage.local.set({
    pb_opts: {
      backendUrl,
      llm: $("llm").checked,
      debug: $("debug").checked
    }
  });
  $("saved").textContent = "Saved";
});

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
