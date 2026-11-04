// Deterministic sampling and dev/test split.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Per dataset: dedupe by text, then take up to `cap` scam and `cap` legit rows.
// Each picked row gets split "dev" or "test" (alternating after shuffle => 50/50 per class).
export function sampleBalanced(rows, { seed = 20261026, cap = 500 } = {}) {
  const out = [];
  const datasets = [...new Set(rows.map((r) => r.dataset))];
  for (const ds of datasets) {
    for (const label of ["scam", "legit"]) {
      const seen = new Set();
      const pool = rows.filter((r) => {
        if (r.dataset !== ds || r.label !== label) return false;
        const key = r.messages.map((m) => m.text).join("\n").trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const rand = mulberry32(seed + ds.length * 31 + (label === "scam" ? 1 : 2));
      shuffle(pool, rand)
        .slice(0, cap)
        .forEach((r, i) => out.push({ ...r, split: i % 2 === 0 ? "dev" : "test" }));
    }
  }
  return out;
}
