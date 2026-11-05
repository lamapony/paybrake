// On-device chat-scam model: hashed word and character n-grams, logistic regression.
// Pure JS, no network, no WebAssembly. The same featurize() is used by the trainer
// (research/chat-scams/train-model.mjs) and in the browser, so the two cannot drift.
//
// Classic script: sets globalThis.pbScamModel. Weights live in scam-model-weights.js
// (globalThis.pbScamModelWeights). If that file is missing or malformed, score()
// returns null and the extension runs on rules alone.
(function () {
  const FEATURE_VERSION = 1;

  // FNV-1a, 32-bit.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function normalize(text) {
    return String(text ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/https?:\/\/\S+|www\.\S+/g, " urltok ")
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " emailtok ")
      .replace(/\d/g, "0")
      .replace(/0[0\s.,]*0/g, "00")
      .replace(/\s+/g, " ")
      .trim();
  }

  function words(norm) {
    return norm.match(/[\p{L}\p{N}]+|[$€£¥!?]/gu) || [];
  }

  // Only the other person's lines. The user's own words never count (same rule as pay-risk.js).
  function counterpartyText(messages) {
    if (!Array.isArray(messages) || !messages.length) return "";
    return messages
      .filter((m) => m && m.from !== "buyer")
      .map((m) => String(m.text ?? ""))
      .join("\n");
  }

  // Returns sparse features { idx: Int32Array, val: Float32Array }, L2-normalized,
  // sublinear term frequency. `bits` is the hash space (2^bits buckets).
  function featurize(text, bits) {
    const mask = (1 << bits) - 1;
    const counts = new Map();
    const add = (key) => {
      const i = hash(key) & mask;
      counts.set(i, (counts.get(i) || 0) + 1);
    };
    const toks = words(normalize(text));
    for (let i = 0; i < toks.length; i++) {
      add("w:" + toks[i]);
      if (i + 1 < toks.length) add("b:" + toks[i] + " " + toks[i + 1]);
      const w = " " + toks[i] + " ";
      if (w.length > 4) {
        for (let n = 3; n <= 5; n++) {
          for (let j = 0; j + n <= w.length; j++) add("c:" + w.slice(j, j + n));
        }
      }
    }
    add("bias:len" + Math.min(6, Math.floor(Math.log2(1 + toks.length))));
    const idx = new Int32Array(counts.size);
    const val = new Float32Array(counts.size);
    let k = 0;
    let norm = 0;
    for (const [i, c] of counts) {
      const v = 1 + Math.log(c);
      idx[k] = i;
      val[k] = v;
      norm += v * v;
      k++;
    }
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < val.length; j++) val[j] /= norm;
    return { idx, val };
  }

  function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
  }

  // Decode the shipped weights once: base64 int8 vector + a float scale.
  let decoded = null;
  let decodeFailed = false;
  function base64ToBytes(b64) {
    if (typeof atob === "function") {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  function load(raw) {
    const w = raw || globalThis.pbScamModelWeights;
    if (!w || w.featureVersion !== FEATURE_VERSION || typeof w.weights !== "string") return null;
    const bytes = base64ToBytes(w.weights);
    if (bytes.length !== 1 << w.bits) return null;
    return {
      bits: w.bits,
      weights: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length),
      scale: w.scale,
      bias: w.bias,
      threshold: w.threshold,
      version: w.version,
      meta: w.meta || {}
    };
  }
  function model() {
    if (decoded || decodeFailed) return decoded;
    try {
      decoded = load();
    } catch (_) {
      decoded = null;
    }
    if (!decoded) decodeFailed = true;
    return decoded;
  }

  function rawScore(text, m) {
    const { idx, val } = featurize(text, m.bits);
    let z = m.bias;
    for (let j = 0; j < idx.length; j++) z += m.weights[idx[j]] * m.scale * val[j];
    return sigmoid(z);
  }

  // score(text, { messages }) -> { p, scam, threshold, version } or null when the model
  // is unavailable or there is no counterparty text. Never throws.
  function score(text, context = {}, override) {
    try {
      const m = override ? load(override) : model();
      if (!m) return null;
      const body = context && Array.isArray(context.messages) && context.messages.length
        ? counterpartyText(context.messages)
        : String(text ?? "");
      if (!body.trim()) return null;
      const p = rawScore(body, m);
      return { p, scam: p >= m.threshold, threshold: m.threshold, version: m.version };
    } catch (_) {
      return null;
    }
  }

  function available() {
    return !!model();
  }

  function info() {
    const m = model();
    return m ? { version: m.version, threshold: m.threshold, bits: m.bits, meta: m.meta } : null;
  }

  // For tests only: forget the cached weights so a new pbScamModelWeights is read.
  function reset() {
    decoded = null;
    decodeFailed = false;
  }

  globalThis.pbScamModel = { FEATURE_VERSION, hash, normalize, featurize, counterpartyText, sigmoid, score, available, info, reset };
})();
