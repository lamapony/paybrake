// Classic content script and a Node ESM side-effect module. No import/export.
// redact(text) masks personal numbers before chat text leaves the browser for the AI check:
// emails, phone numbers, card numbers, IBANs (all but the last 4), ID numbers and codes.
// The rules engine always runs on the original text, locally.

function digitsOf(value) {
  return String(value).replace(/\D/g, "");
}

function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b([A-Z]{2})(\d{2})((?:[ ]?[A-Z0-9]){10,30})\b/g;
const CARD = /(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g;
const CPR = /(?<![\d])\d{6}-?\d{4}(?![\d])/g;
const SSN = /(?<![\d])\d{3}-\d{2}-\d{4}(?![\d])/g;
const CODE = /((?:code|kode|koden|otp|pin|password|passcode|adgangskode)(?:\s+(?:is|er|was))?\s*[:=]?\s*)(\d{4,8})(?![\d])/giu;
const PHONE = /(?<![\w])(?:\+|00)?\d[\d\s().-]{6,18}\d(?![\d])/g;

function redact(text) {
  let out = String(text ?? "");
  out = out.replace(EMAIL, "[email]");
  out = out.replace(IBAN, (match, cc, _check, rest) => {
    const compact = (cc + _check + rest).replace(/ /g, "");
    if (compact.length < 15 || !/\d{6,}/.test(compact.replace(/[A-Z]/g, ""))) return match;
    return cc + "[IBAN ending " + compact.slice(-4) + "]";
  });
  out = out.replace(CARD, (match) => {
    const d = digitsOf(match);
    if (d.length < 13 || d.length > 19) return match;
    if (!luhn(d)) return match;
    return "[card ending " + d.slice(-4) + "]";
  });
  out = out.replace(SSN, "[id number]");
  out = out.replace(CPR, "[id number]");
  out = out.replace(CODE, (_m, label) => label + "[code]");
  out = out.replace(PHONE, (match) => (digitsOf(match).length >= 8 ? "[phone]" : match));
  return out;
}

globalThis.pbRedact = { redact };
