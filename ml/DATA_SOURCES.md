# Pretrain data sources

Raw files are **not committed**. Fetch with `python ml/fetch_datasets.py` (writes to `../paybrake-datasets`,
override with `$PAYBRAKE_DATASETS`). Hand-labeled `data/labeled/seed.jsonl` is the evaluation set.

| File | Source | Licence | Rows used | Notes |
|---|---|---|---|---|
| BothBosu__multi-agent-scam-conversation.csv | https://huggingface.co/datasets/BothBosu/multi-agent-scam-conversation | Apache-2.0 | 1600 (800 scam / 800 not) | LLM-generated phone-call scam dialogues (EN) |
| BothBosu__scam-dialogue.csv | https://huggingface.co/datasets/BothBosu/scam-dialogue | Apache-2.0 | 1600 (800/800) | LLM-generated scam call dialogues (EN) |
| FredZhang7__all-scam-spam.csv | https://huggingface.co/datasets/FredZhang7/all-scam-spam (`junkmail_dataset.csv`) | Apache-2.0 | 6000 sampled of 42,619, truncated to 2000 chars | Email/SMS spam+scam, mostly EN |
| ucirvine__sms_spam.csv (optional, `--sms`) | https://huggingface.co/datasets/ucirvine/sms_spam ; UCI ML Repository "SMS Spam Collection" | CC BY 4.0 | all, only with `eval_pretrain.py --sms` | **Attribution required**: Almeida, T.A., Gómez Hidalgo, J.M., Yamakami, A. "Contributions to the Study of SMS Spam Filtering: New Collection and Results." DocEng 2011. Not used for the shipped model.json. |

Apache-2.0 notices: datasets © their respective authors (BothBosu, FredZhang7), used under Apache License 2.0.
The shipped `ml/model.json` contains only derived n-gram weights, not raw text.
