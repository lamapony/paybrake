# Nested grouped CV (2026-11-03) — `python ml/eval_nested.py`

Pool: seed.jsonl (18 scam/17 honest) + da_synthetic.jsonl (72/80). Outer 5-fold StratifiedGroupKFold
(synthetic grouped by pattern -> whole patterns unseen at test). Thresholds tuned only on inner 3-fold OOF scores of
outer-train ("0FA-tuned" = above max inner honest score, "1FA-tuned" = above 2nd max), applied to outer test.
FA = false alarms actually observed on held-out honest. A/B never train on da (scored as fully held out).

| Variant | seed recall (FA/17) @0FA-tuned | seed @1FA-tuned | da recall (FA/80) @0FA-tuned | da @1FA-tuned |
|---|---|---|---|---|
| A before: word, seed only | 0.167 (1) | 0.222 (1) | 0.139 (0) | 0.181 (0) |
| B prev commit: char + public + seed | 0.278 (1) | 0.278 (2) | 0.014 (2) | 0.042 (5) |
| C new (model.json): char + public + TOMATO + seed + da | 0.333 (0) | 0.556 (1) | 0.208 (3) | 0.347 (5) |

model.json (C, 3000 terms): 73,562 bytes; exported threshold 0.885 (0 FA in grouped CV on all 187 labeled rows, recall 0.156 there).
