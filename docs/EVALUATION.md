# Evaluation

All numbers on this page were measured on 9 Nov 2026 at commit `2517017`: rules version 5, model `lr-h18-f1-2026-11-05`, threshold 0.922. Earlier figures elsewhere in the repo (for example in [SUBMISSION-GAPS.md](SUBMISSION-GAPS.md) or [eval/real/RESULTS.md](../eval/real/RESULTS.md)) are records of their own date and may not match.

## The three sets

**In-repo marketplace chats.** `eval/cases/pay-risk.json`, 39 chats (18 scams, 21 honest), written by the team. This is a regression gate. `npm run eval` exits 1 if precision is under 0.95, recall is under 0.80, or any safe case fires.

**Held-out synthetic chats.** `data/chat-scams/heldout.jsonl`, 100 chats (65 Danish, 35 English), written by a separate model run. Still synthetic.

**Public datasets.** Four Hugging Face sets pinned in `eval/real/sources.json`, sampled and split into dev and test. Only the test split is reported here. `npm run eval:real:download` fetches them into `eval/real/.data/`, which is not committed.

## Results

| Set | System | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| In-repo, 39 chats | rules | 18 | 0 | 0 | 21 | 1 | 1 | 1 | 0 |
| | model alone | 5 | 0 | 13 | 21 | 1 | 0.278 | 0.435 | 0 |
| | rules + model | 18 | 0 | 0 | 21 | 1 | 1 | 1 | 0 |
| Held-out, 100 chats | rules | 21 | 3 | 19 | 57 | 0.875 | 0.525 | 0.656 | 0.05 |
| | model alone | 28 | 0 | 12 | 60 | 1 | 0.7 | 0.824 | 0 |
| | rules + model | 35 | 3 | 5 | 57 | 0.921 | 0.875 | 0.897 | 0.05 |
| Held-out, Danish (65) | rules + model | 23 | 2 | 2 | 38 | 0.92 | 0.92 | 0.92 | 0.05 |
| Held-out, English (35) | rules + model | 12 | 1 | 3 | 19 | 0.923 | 0.8 | 0.857 | 0.05 |
| Public test split, 1,573 messages | rules | 325 | 9 | 388 | 851 | 0.973 | 0.456 | 0.621 | 0.01 |
| | model alone | 334 | 2 | 379 | 858 | 0.994 | 0.468 | 0.637 | 0.002 |
| | rules + model | 362 | 11 | 351 | 849 | 0.971 | 0.508 | 0.667 | 0.013 |

Public test split by dataset, rules then rules + model:

| Dataset | Messages | Recall | False alarms |
|---|---:|---|---|
| Real SMS (`sms_spam`) | 500 | 0 → 0.016 | 0 → 0 of 250 |
| Real Discord (`discord`) | 388 | 0.232 → 0.261 | 1 → 3 of 250 |
| Scam dialogues (`scam_dialogue`, synthetic) | 500 | 0.9 → 1 | 3 → 3 of 250 |
| ScamGuardBench (`scamguardbench`, synthetic) | 185 | 0.907 → 0.96 | 5 → 5 of 110 |

## How to reproduce

```sh
npm test
npm run eval                                       # in-repo set, rules
npm run rescore:model                              # in-repo set, shipped weights
npm run eval:real:download
npm run eval:real:model                            # public test split, shipped weights, real detect() path
node research/chat-scams/train-model.mjs --no-write   # prints every row above
```

`--no-write` matters. Without it the trainer overwrites `extension/lib/scam-model-weights.js`. `npm run eval:real:model` also writes a new file under `eval/real/results/`.

The held-out and rules-only rows come from the trainer, which refits the model with a fixed seed. On this run it landed on the shipped threshold (0.922) and reproduced the rules + model row on the public test split that `npm run eval:real:model` measures with the shipped weights.

## How to read these numbers

- The in-repo set was written by the people who wrote the rules. A perfect score there says the rules still do what their tests say.
- The model's gain on public data is mostly on the two synthetic datasets, whose other rows were in training. Their test rows are held out, but they come from the same generator. Transfer to real SMS and real Discord is small, and on real Discord it costs 2 extra false alarms.
- The held-out chats are synthetic and there are only 100 of them. One chat moves recall by 2.5 points.
- No set here is real marketplace traffic.

## The model

Hashed word and character n-grams (2^18 buckets, sublinear term frequency, L2 normalized, no IDF) feed a logistic regression with int8 weights, stored in `extension/lib/scam-model-weights.js` (349,985 bytes). The same featurizer runs in the trainer and in the extension.

It was trained on 1,480 chats: `scam_dialogue` 1,098, `scamguardbench` 185, `data/chat-scams/seed.jsonl` 37, `data/chat-scams/train-synth.jsonl` 160. Real SMS and real Discord text is never trained on; their dev split is used only to pick the threshold.

When the rules find no payment ask (`no_atom` or `weak_only`) and the other person's lines score at or above the threshold, the model adds a medium card marked **On-device model**. It never raises a rules card, never overrides a checkout veto or a short chat, and never reads the user's own lines. If the weights fail to load, `detect()` reports `model: "unavailable"` and the rules run alone.

Browser check: `npm run e2e:model` loads the unpacked extension in Chromium.
