# Labeling chats for the PayBrake ML model

Goal: **200 chats**. Put files in `data/labeled/` as **JSONL** (one chat per line). CSV is fine too, using the same columns (see `data/labeled/template.csv`); convert it before training.

| field | required | value |
|---|---|---|
| `id` | yes | unique, e.g. `fb-0001`, `dba-0042` |
| `source` | yes | platform: `facebook-marketplace`, `dba`, `vinted`, `whatsapp`, `telegram`, `ebay`, `synthetic`, ... |
| `language` | yes | ISO code: `da`, `en`, `ru`, `uk`, `de`, ... |
| `text` | yes | the whole chat, one message per line, prefixed `buyer:` / `seller:` |
| `label` | yes | `scam` or `honest` |
| `scam_type` | for scams | e.g. `upfront_deposit`, `friends_family`, `fake_shipping_link`, `gift_card`, `overpayment`, `off_platform`; empty for honest |
| `notes` | no | anything useful (where it came from, if the scam was confirmed) |

Example line:

```json
{"id":"fb-0001","source":"facebook-marketplace","language":"da","text":"buyer: Hej, er cyklen stadig til salg?\nseller: Ja. Send 500 kr på MobilePay til [PHONE] som depositum.","label":"scam","scam_type":"upfront_deposit","notes":""}
```

## Rules

1. **At least as many honest chats as scam chats.** Honest deals that talk about money (MobilePay, PayPal, shipping, deposits for real reasons) are the most valuable: they teach the model *not* to warn.
2. **Strip personal data.** Replace names with `[NAME]`, phones with `[PHONE]`, emails with `[EMAIL]`, IBAN/card numbers with `[ACCOUNT]`, street addresses with `[ADDRESS]`, links to personal profiles with `[URL]`. Keep payment *methods* and amounts.
3. Label only what you are sure of. Unsure → leave it out or write it in `notes`.
4. Do not edit the wording otherwise (typos and slang help).
5. No screenshots — text only.

## Train

```
pip install scikit-learn numpy
python ml/train.py            # CV metrics + ml/model.json
python ml/autotune.py --trials 50   # variant search, logs ml/results.tsv
python ml/dump_scores.py && node --test tests/ml-scorer.test.mjs   # JS/Python parity
```

`data/labeled/seed.jsonl` is generated from `eval/cases/pay-risk.json` by `ml/seed_from_eval.py` (35 synthetic dialogs).
The extension scorer is `extension/lib/ml-scorer.js`, flag `ML_SCORER_ENABLED = false`, not wired into the brake. Rules stay primary.
