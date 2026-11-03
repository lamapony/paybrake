/* PayBrake experimental ML scorer (TF-IDF + logistic regression, trained by ml/train.py).
   Feature flag ML_SCORER_ENABLED is OFF by default and this module is NOT wired into
   detect() or the brake card. Rules stay primary; this only returns a score. */
export const ML_SCORER_ENABLED = false;

const TOKEN_RE = /[\p{L}\p{N}]+/gu; // matches Python [^\W_]+ (letters/digits, no underscore)

export function tokenize(text, ngramMax = 2) {
  const toks = String(text).toLowerCase().match(TOKEN_RE) || [];
  const out = [...toks];
  for (let n = 2; n <= ngramMax; n++)
    for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(" "));
  return out;
}

/** sklearn char_wb semantics (matches ml/common.py char_ngrams): per word, space-padded. */
export function charNgrams(text, nmin = 2, nmax = 4) {
  const out = [];
  for (const word of String(text).toLowerCase().split(/\s+/u)) {
    if (!word) continue;
    const w = Array.from(" " + word + " ");
    for (let n = nmin; n <= nmax; n++) {
      if (w.length <= n) { out.push(w.join("")); break; }
      for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(""));
    }
  }
  return out;
}

export function score(model, text) {
  const { ngram_max = 2, sublinear_tf = true, analyzer = "word", char_min = 2, char_max = 4 } = model.params || {};
  const counts = new Map();
  const grams = analyzer === "char_wb" ? charNgrams(text, char_min, char_max) : tokenize(text, ngram_max);
  for (const t of grams) if (model.terms[t]) counts.set(t, (counts.get(t) || 0) + 1);
  let norm = 0;
  const w = [];
  for (const [t, c] of counts) {
    const tf = sublinear_tf ? 1 + Math.log(c) : c;
    const v = tf * model.terms[t][0];
    w.push([t, v]);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  let z = model.intercept;
  for (const [t, v] of w) z += (v / norm) * model.terms[t][1];
  const p = 1 / (1 + Math.exp(-z));
  return { score: p, warn: p >= model.threshold, threshold: model.threshold };
}

/** Returns null unless the flag (or an explicit override) is on. */
export function maybeScore(model, text, { enabled = ML_SCORER_ENABLED } = {}) {
  return enabled && model ? score(model, text) : null;
}
