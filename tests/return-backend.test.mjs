import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadReturnBackend() {
  const html = await readFile(new URL("../demo/checkout-return.html", import.meta.url), "utf8");
  const start = html.indexOf("// return-backend:start");
  const end = html.indexOf("// return-backend:end");
  assert.ok(start !== -1 && end > start, "returnBackend markers missing");
  const body = html.slice(start, end);
  return new Function(body + "\nreturn returnBackend;")();
}

test("plain-http approval uses port 8787 on that host, https stays on its origin", async () => {
  const returnBackend = await loadReturnBackend();
  assert.equal(
    returnBackend({ protocol: "http:", hostname: "192.168.1.5", origin: "http://192.168.1.5:8080" }),
    "http://192.168.1.5:8787"
  );
  assert.equal(
    returnBackend({ protocol: "http:", hostname: "localhost", origin: "http://localhost:8080" }),
    "http://localhost:8787"
  );
  assert.equal(
    returnBackend({ protocol: "http:", hostname: "127.0.0.1", origin: "http://127.0.0.1:8080" }),
    "http://127.0.0.1:8787"
  );
  assert.equal(
    returnBackend({ protocol: "http:", hostname: "::1", origin: "http://[::1]:8080" }),
    "http://[::1]:8787"
  );
  assert.equal(
    returnBackend({ protocol: "https:", hostname: "paybrake-demo.spbabinov.workers.dev", origin: "https://paybrake-demo.spbabinov.workers.dev" }),
    "https://paybrake-demo.spbabinov.workers.dev"
  );
  assert.equal(returnBackend({ protocol: "http:", hostname: "", origin: "" }), "http://localhost:8787");
});
