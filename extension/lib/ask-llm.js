// Classic content script and a Node ESM side-effect module. No import/export.
// Calls our backend /api/classify. Never calls a model provider directly.
// Test-only pages may use this through the in-page shim in content.js.

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}

async function askLlm(payload, options = {}) {
  const base = trimSlash(options.baseUrl || "http://localhost:8787");
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { text: payload && payload.text != null ? payload.text : payload };
    // Send the rules level so the server can cap the AI level (the AI never raises it).
    const level = payload && payload.level;
    if (level === "high" || level === "medium") body.rulesLevel = level;
    const res = await fetchImpl(base + "/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error((data && data.error) || `classify ${res.status}`);
      error.status = res.status;
      error.code = data && data.error;
      throw error;
    }
    if (!data || typeof data !== "object") {
      const error = new Error("classify returned a non-JSON body");
      error.status = res.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

globalThis.pbAskLlm = { askLlm };
