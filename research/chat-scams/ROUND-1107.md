# Round 1107: Danish hard negatives and source-specific calibration (rejected)

**Outcome: rejected. The shipped model is unchanged.** `extension/lib/scam-model-weights.js` is byte-identical to the base (349,985 B, sha256 `9116b572…fe5fb0`, version `lr-h18-f1-2026-11-05`, threshold 0.922). Neither goal was met: real Discord false alarms ≤ 1/250 **and** higher recall.

## What was tried

- **New data:** 136 synthetic chats generated for this round by `generate-v2.py` (`data/chat-scams/{train-synth,dev-synth,holdout}-v2.jsonl`). Train has 64 (32 scam / 32 legit), dev 32 (16/16), holdout 40 (20/20). Families cover family impersonation, MitID or bank codes, fake delivery and payment verification, marketplace deposits, and hard legit chats about money, rent, safe trades, parcels and Discord.
- **Driver:** `research/chat-scams/round-1107.mjs` uses the same featurizer, loss and int8 quantization as `train-model.mjs`, which is unchanged.
- **Training data:** the public synthetic non-test rows, seed, train-synth v1 and train-synth-v2. **No real SMS or Discord row was trained on.**
- **Threshold:** real SMS and Discord **dev** rows supplied only legit-row false-alarm counts for the threshold. The rule is the lowest t ≥ 0.5 where the model adds 0/250 on Discord dev, ≤ 1/250 on SMS dev and ≤ 3% on synthetic-dev legit, plus 0.02. Real-dev TPs were never computed.
- **Candidates:** 3 configs fixed before fitting and one seed (11). The winner was chosen by synthetic-dev recall.
- **Final test:** run **once** on the frozen winner and the shipped baseline (ledger: 1 entry). The threshold was not retuned and nothing was retrained.

## Results (rules ∨ model, the product policy)

Before = shipped model. After = frozen candidate C1 (t = 0.987).

| Set (scam / legit) | Rules only: TP · FP | Before: P / R · FP | After: P / R · FP |
|---|---|---|---|
| Discord test (138 / 250) | 32 · 1/250 | 0.923 / 0.261 · **3/250** | 0.971 / 0.239 · **1/250** |
| SMS test (250 / 250) | 0 · 0/250 | 1.000 / 0.016 · 0/250 | 1.000 / 0.012 · 0/250 |
| Pooled real test (388 / 500) | 32 · 1/500 | 0.930 / 0.103 · 3/500 | 0.973 / 0.093 · 1/500 |
| scam_dialogue test (250 / 250) | 225 · 2/250 | R 1.000 · 2/250 | R 1.000 · 2/250 |
| scamguardbench test (75 / 110) | 68 · 5/110 | R 0.960 · 5/110 | R 0.960 · 5/110 |
| heldout100 (40 / 60) | 19 · 3/60 | 0.917 / 0.825 · 3/60 | 0.900 / 0.675 · 3/60 |
| holdout-v2 (20 / 20) | 12 · 4/20 | 0.789 / 0.750 · 4/20 | 0.750 / 0.600 · 4/20 |
| pay-risk cases (18 / 17) | 18 · 0/17 | R 1.000 · 0/17 | R 1.000 · 0/17 |

Ship rule (fixed before the test):
- Discord FP ≤ 1: **pass** (1/250).
- SMS FP ≤ baseline + 1: **pass**.
- Pooled real TP above baseline: **fail** (36 vs 40).

The candidate reaches 1/250 on Discord only by muting the model (t = 0.987). Every set loses recall.

On synthetic dev, all three configs tied with each other and with the shipped model: rules ∨ model R 0.75, FP 3/16. The model added 0 TPs at t = 0.977–0.989. C1 won on config order, and `devVerdict` was `no_improvement_on_synth_dev`. The full candidate table is in `round-1107/train-results.json`.

## Limitations (read before citing any number)

1. **Small and single-seed.** 64/32/40 chats against a plan of about 900/250/200. One seed and 3 configs (not 18 fits), so there is no variance estimate. Synthetic-dev recall moves in steps of 1/16.
2. **Label shortcut in the synthetic data.** In train and dev, every scam has 5 turns (3 from the counterparty) and every legit chat has 4 (2). Every chat is opened by the counterparty. The hardened `validate` now rejects this data (`round-1107/validate-hardened.json`: `label separable by: train:turns, train:themTurns, dev:turns, dev:themTurns`). The data and results are left exactly as they were produced.
3. **Dev is not family-independent.** Each template has one row, so splitting by template was the same as splitting by row, and all 12 dev families also appear in train.
4. **Holdout-v2 independence is limited.** It was generated in a separate Grok context that was not shown the training rows, but by the same model and author. It is not a different author. It has 40 rows.
5. **Exposure.** The real test split and heldout100 were scored in earlier rounds (rules v1–v4 and PR60's model). The test split is identical to earlier rounds (1573 ids, 0 missing).
6. **Rules fire on the new hard negatives.** Rules alone flag 3/16 synthetic-dev and 4/20 holdout-v2 legit chats. That points at the rules, not the model.
7. **The shipped baseline trained on 9 rows that duplicate SMS corpus text.** Counts only:
   - `train-model.mjs` keeps 185 scamguardbench rows; this driver keeps 176.
   - All 9 removed rows exactly match messages in the UCI SMS corpus. None is in the SMS **test** split.
   - 3 are SMS **dev** rows (2 of them labelled scam in SMS but legit in scamguardbench), and 6 are unsampled.
   - So the shipped model's SMS-dev calibration saw 3 of its own training texts. Its SMS test numbers are not affected.

## Sizes

| File | Bytes | sha256 |
|---|---|---|
| Shipped `extension/lib/scam-model-weights.js` (unchanged) | 349,985 | `9116b572a3d09a06908afd4c61a38afcba9342204dd5c81c9612c94a40fe5fb0` |
| Frozen C1 weights file (not committed, rejected) | 350,007 | `11bd15fc64a31d9e2900f47c4de2672570105e3603abe37e1c01401d9cc4a557` |
| Size-check probe during `train` (same weights, placeholder version and meta) | 349,865 | — |

The audit's 349,865 B and Grok's 350,007 B describe different files. The first is the probe file written by the size check. The second is the frozen file with its real version and meta strings. All are under 500 KB, use int8 at 2^18, and run offline.

## Recommendation for deployment

**Turn the on-device model off by default** until a stronger round passes. The shipped model adds false alarms on real Discord (3/250 against 1/250 for rules alone), which breaks the ≤ 1/250 target. The only candidate that met the target lost recall. This PR does **not** change PR60's default; it is a recommendation only.

## Driver status: not production-ready

The results above came from driver revision sha256 `f5565714…0fb8ef9` (recorded in `round-1107/manifest.json`). After the audit, the driver was hardened without rerunning anything:
- **F1:** `ship` now also requires `devVerdict = candidate_beats_baseline_on_synth_dev`.
- **F3:** an empty calibration group throws.
- **F5:** the snapshot hashes the driver and runtime code, and final-test refuses if they changed.
- **F6:** `validate` rejects labels that turn counts or the opener alone separate.
- **F7:** parse errors report only file and line.
- Tests in `tests/round-1107.test.mjs` cover these.

**Still open; unsafe for a new round until fixed:**
- **F4:** the test ledger lives under `--out-dir`, so another out-dir can bypass the once-only rule.
- **F9:** seed rows skip dedupe and exclusion.
- **F2:** the ship bar counts +1 TP as an improvement; predeclare at least +4 TP.
- Dev and holdout are near-dup checked against public test rows but not against public training rows.

## Next round

1. Several hundred chats per split, with varied lengths, roles and openers, split by family, passing the hardened `validate`.
2. Fix F2, F4 and F9 first.
3. Use at least 3 seeds.
4. Keep the rules false alarms on hard negatives as a separate task.

## Files

- `round-1107/train-results.json`, `final-summary.json`, `validate-original.json` (what the original driver produced), `validate-hardened.json`, `manifest.json`.
- Metrics, ids and hashes only. No message text; per-row probabilities stay outside the repo.
