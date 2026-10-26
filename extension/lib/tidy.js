// Classic content script and a Node ESM side-effect module. No import/export.
// JS \b does not treat æ, ø, and å as letters, so Danish words such as
// "overførsel", "forskud", and "afhentning" need Unicode lookarounds (flag u).
// globalThis.pbTidy is the shared surface. See lib/index.js for the ESM re-export.

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function wordBound(pattern, flags = "giu") {
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  const withUnicode = flags.includes("u") ? flags : flags + "u";
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, withUnicode);
}

globalThis.pbTidy = { cleanText, wordBound };
