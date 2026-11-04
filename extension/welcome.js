// Point the demo button at the backend in use: hosted by default, localhost for dev.
(async function () {
  const cfg = globalThis.pbConfig;
  const link = document.getElementById("demo");
  try {
    const stored = await chrome.storage.local.get("pb_opts");
    const backend = String((stored.pb_opts && stored.pb_opts.backendUrl) || cfg.DEFAULT_BACKEND);
    link.href = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(backend) ? cfg.LOCAL_DEMO_URL : cfg.DEMO_URL;
  } catch {
    link.href = cfg.DEMO_URL;
  }
})();
