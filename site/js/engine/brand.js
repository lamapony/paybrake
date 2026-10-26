// Classic content script and a Node ESM side-effect module. No import/export.
// Shared surface is globalThis.pbBrand. Node tests re-export it from ./index.js.
globalThis.pbBrand = {
  NAME: "PayBrake",
  TAGLINE: "Brakes before you pay."
};
