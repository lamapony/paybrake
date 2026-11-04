// formatAmount and assertSandbox live here so paypal.js, paypal-rest.js, and
// paypal-toolkit.js do not import each other.

export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const error = new Error("amount must be a number");
    error.status = 400;
    error.code = "bad_request";
    throw error;
  }
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function assertSandbox(env = {}) {
  const paypalEnv = String(env.PAYPAL_ENV || "").trim().toLowerCase();
  if (paypalEnv !== "sandbox") {
    throw new Error("Refusing to start unless PAYPAL_ENV=sandbox");
  }
}
