# Real-message eval (Hugging Face scam / ham datasets)

The 35-chat synthetic eval in `eval/cases/` was written by us and scores 1.0 / 1.0.
This harness runs the same detector (`extension/lib`) on third-party public data.
Current rules are v4. The measured rules numbers are at the top of `RESULTS.md`. The v1–v3 and AI figures below that are the 26 Oct log.

```
npm run eval:real:download     # pinned HF revisions -> eval/real/.data/ (gitignored)
npm run eval:real              # rules only -> eval/real/results/rules-v<RULES_VERSION>.json
OPENROUTER_API_KEY=... node eval/real/run-real.mjs --llm --llm-n=200   # v1/v2: rules+LLM (confirm only) and LLM-alone
node eval/real/run-real.mjs --report                                    # print the test split too (dev only by default)
OPENROUTER_API_KEY=... node eval/real/run-llm-all.mjs --split=dev --n=all --sweep   # v3: AI check on all chats, threshold sweep
OPENROUTER_API_KEY=... node eval/real/run-llm-all.mjs --split=test --n=200          # same 200 as v1/v2
OPENROUTER_API_KEY=... node eval/real/run-llm-all.mjs --split=test --n=all
```

`run-llm-all.mjs` caches model answers in `.data/llm-cache.json` (gitignored), keyed by model + prompt + the
redacted transcript, so reruns with changed thresholds or rules cost nothing. Failed calls are not cached.

## Datasets (pinned in `sources.json`)

| key | HF dataset | license | origin | used (scam / legit) |
|---|---|---|---|---|
| sms_spam | [codesignal/sms-spam-collection](https://huggingface.co/datasets/codesignal/sms-spam-collection) | CC-BY-4.0 | real SMS (UCI SMS Spam Collection) | 500 / 500 of 747 / 4825 |
| discord | [wangyuancheng/discord-phishing-scam](https://huggingface.co/datasets/wangyuancheng/discord-phishing-scam) | MIT | real Discord messages | 277 / 500 of 278 / 1722 |
| scam_dialogue | [BothBosu/scam-dialogue](https://huggingface.co/datasets/BothBosu/scam-dialogue) | Apache-2.0 | synthetic phone dialogues (third party) | 500 / 500 of 800 / 800 |
| scamguardbench | [flowxai/scamguardbench](https://huggingface.co/datasets/flowxai/scamguardbench) v0.2 `standard`, EN only | Apache-2.0 | mostly synthetic SMS/email/chat, incl. hard legit confusables | 150 / 220 (all EN) |

All four allow redistribution, but we still commit only the download script, pinned revisions, and
per-row predictions (ids, labels, signals, short evidence spans). No message bodies are committed.

## Mapping into PayBrake's input (what is lost or invented)

PayBrake's detector takes `detect(text, { messages:[{from,text}], listingTitle?, listingPrice? })`.

- **No listing context.** None of the datasets has a listing title or price, so `context` is empty.
  Nothing is invented; this only affects the deal card, not the risk verdict.
- **Single messages** (SMS, Discord, ScamGuardBench) become one message from the counterparty (`from: "seller"`).
- **Phone dialogues** are split on `caller:` / `receiver:`; caller -> counterparty (`seller`), receiver -> user (`buyer`).
  Since v3 the speaker matters: only counterparty lines raise signals, and the AI must quote a counterparty line.
- **Not a marketplace.** None of these are marketplace buyer/seller chats; there is no public HF dataset of those
  that we could find. PayBrake only targets *how a payment is asked for* (F&F, deposits, off-platform rails, pay-first).
  Prize spam, Nitro phishing, credential phishing and tech-support scams are mostly out of its scope by design.
- **"Pay-ask" subset.** For ScamGuardBench only, the dataset's own tactic labels let us mark scams where the victim is
  asked to move money (`payment_redirect`, `refund_overpayment`, `courier_customs_fee`, `romance_advance_fee`,
  `family_emergency_impersonation`, `investment_too_good`). That subset is the closest thing to PayBrake's scope.
- **Labels are the datasets' labels.** Some are debatable: ScamGuardBench labels "Hi, it's me, lost my phone, send 150 to my IBAN"
  as a *legit* family money request; PayBrake flags it. We count that as a false positive anyway.

## Sampling and splits

Per dataset: exact-duplicate texts removed, then up to 500 scam + 500 legit rows drawn with seed `20261026`
(mulberry32 shuffle). Every picked row is assigned `dev` or `test` alternately after the shuffle (50/50 per class).
Rule changes in RULES_VERSION 2 and 3 and the v3 AI thresholds were designed by looking at **dev** rows only;
report **test** numbers. `run-real.mjs` prints only dev unless `--report` is given.

## LLM run

`--llm` takes a stratified subsample of the **test** split (25 per dataset x label = 200) and runs:
1. **rules + LLM** exactly as the product does: the model is only asked when rules fire and can only confirm or lower.
2. **LLM alone**: the backend's classify prompt on every message (not how the product works today; shows headroom).
The key is read from the environment and never printed.
