// Classic content script and a Node ESM side-effect module. No import/export.
// Amounts: "500 kr", "kr 500", "DKK 1.800", "1,800 kr", "€45", "45 EUR", "$120", "1500 NOK", "1500 SEK".

function parseLocalizedNumber(raw) {
  const s = String(raw).replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^\d+,\d{1,2}$/.test(s)) return Number(s.replace(",", "."));
  if (/^\d+\.\d{3}$/.test(s)) return Number(s.replace(".", ""));
  if (/^\d+\.\d{1,2}$/.test(s)) return Number(s);
  if (/^\d+$/.test(s)) return Number(s);
  return Number.NaN;
}

function currencyOf(raw) {
  if (/€|eur|euro/i.test(raw)) return "EUR";
  if (/\$|usd/i.test(raw)) return "USD";
  if (/£|gbp|pound/i.test(raw)) return "GBP";
  // The amount span is only the matched token ("1500 NOK"), so a later Danish
  // "er nok" never reaches this. A bare number still does not match CUR.
  if (/nok/i.test(raw)) return "NOK";
  if (/sek/i.test(raw)) return "SEK";
  return "DKK";
}

const NUM = String.raw`\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
// Danish "nok" means "probably" and often sits before a number ("Det bliver nok
// 500 kr", "Den er nok 2 år"). So nok/sek count before a number only in capitals
// ("NOK 1500"); after a number ("1500 nok") any case is fine.
const CUR_PRE = String.raw`kr\.?|kroner|dkk|eur|euro|usd|€|\$|£|gbp|pounds?`;
const CUR = String.raw`${CUR_PRE}|nok|sek`;
const AMOUNT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?:${CUR_PRE})\s*(${NUM})|(${NUM})\s*(?:${CUR}))(?![\p{L}\p{N}])`,
  "giu"
);
// Case-sensitive on purpose (no "i" flag): only a capital NOK/SEK code.
const CODE_FIRST_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:NOK|SEK)\s*(${NUM})(?![\p{L}\p{N}])`, "gu");

function amountMatches(text) {
  const main = [...text.matchAll(AMOUNT_RE)];
  const extra = [...text.matchAll(CODE_FIRST_RE)].filter((m) =>
    main.every((n) => m.index + m[0].length <= n.index || n.index + n[0].length <= m.index)
  );
  return extra.length ? [...main, ...extra].sort((a, b) => a.index - b.index) : main;
}

function parseAmounts(input) {
  const text = String(input ?? "");
  const out = [];
  AMOUNT_RE.lastIndex = 0;
  for (const match of amountMatches(text)) {
    const raw = match[0];
    const num = match[1] || match[2];
    const value = parseLocalizedNumber(num);
    if (!Number.isFinite(value)) continue;
    out.push({
      value,
      currency: currencyOf(raw),
      text: raw.trim(),
      start: match.index,
      end: match.index + raw.length
    });
  }
  return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function findEmail(text) {
  const match = String(text ?? "").match(EMAIL_RE);
  return match ? match[0] : null;
}

function depositAmount(text, amounts, atoms) {
  const deposits = (atoms || []).filter((atom) => atom.atom === "upfront_deposit");
  if (!deposits.length || !amounts.length) return null;
  let best = null;
  let bestGap = Infinity;
  for (const amount of amounts) {
    for (const deposit of deposits) {
      const gap = amount.end <= deposit.start
        ? deposit.start - amount.end
        : amount.start >= deposit.end
          ? amount.start - deposit.end
          : 0;
      if (gap < bestGap && gap <= 40) {
        bestGap = gap;
        best = amount;
      }
    }
  }
  return best;
}

function extractDeal(text, ctx = {}, atoms = []) {
  const source = String(text ?? "");
  const amounts = parseAmounts(source);
  const listingRaw = ctx.listingPrice != null ? String(ctx.listingPrice) : "";
  const listing = parseAmounts(listingRaw)[0] || null;
  const deposit = depositAmount(source, amounts, atoms);
  const emailInChat = findEmail(source);
  const payeeEmail = emailInChat || (ctx.sellerEmail ? String(ctx.sellerEmail).trim() : null) || null;
  const item = (ctx.listingTitle && String(ctx.listingTitle).trim()) || null;
  let amount = null;
  let currency = null;
  if (listing) {
    amount = listing.value;
    currency = listing.currency;
  } else {
    const rest = amounts.filter((entry) => !deposit || entry.start !== deposit.start);
    const chosen = rest.sort((a, b) => b.value - a.value)[0] || deposit || null;
    amount = chosen ? chosen.value : null;
    currency = chosen ? chosen.currency : null;
  }
  if (!currency && deposit) currency = deposit.currency;
  return {
    item,
    amount,
    currency,
    depositAmount: deposit ? deposit.value : null,
    payeeEmail
  };
}

globalThis.pbExtract = {
  parseAmounts,
  parseLocalizedNumber,
  findEmail,
  extractDeal
};
