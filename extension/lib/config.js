/* PayBrake config. Classic script: sets globalThis.pbConfig.
   HOSTED_BACKEND is the free mock-mode test server (no real money).
   LOCAL_BACKEND is for development: npm run dev:backend. */
(function () {
  const HOSTED = "https://paybrake-demo.spbabinov.workers.dev";
  globalThis.pbConfig = Object.freeze({
    HOSTED_BACKEND: HOSTED,
    LOCAL_BACKEND: "http://localhost:8787",
    DEFAULT_BACKEND: HOSTED,
    DEMO_URL: HOSTED + "/demo/marketplace.html?live=1",
    LOCAL_DEMO_URL: "http://localhost:8080/demo/marketplace.html?live=1"
  });
})();
