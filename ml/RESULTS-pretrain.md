# Pretrain eval (2026-11-03) — `python ml/eval_pretrain.py --seed-weight 20 [--sms]`

Eval set: data/labeled/seed.jsonl (35: 18 scam / 17 honest). Char_wb 2–4 TF-IDF, max_features=3000, LR balanced.
Thresholds picked on the same 35 rows (optimistic, n is tiny).

| Variant | recall @0 FA | recall @≤1 FA |
|---|---|---|
| seed-only word CV (previous baseline) | 0.222 | 0.278 |
| seed-only char CV | 0.111 | 0.333 |
| pretrain-only (Apache-2.0 set) → seed held-out | 0.056 | 0.056 |
| pretrain + seed, seed-fold CV (seed_weight 20) — **shipped model.json** | 0.222 | 0.389 |
| pretrain-only incl. UCI SMS (CC BY 4.0) | 0.111 | 0.222 |
| pretrain incl. UCI SMS + seed CV | 0.333 | 0.500 |

model.json: 3000 terms, 73,534 bytes. Public data is phone/email/SMS scams, not marketplace chat: pretrain alone does not transfer.
