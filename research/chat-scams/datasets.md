# Public datasets for chat-scam detection

Checked **4 November 2026**. Sizes are from the Hugging Face datasets-server `size` endpoint unless a dataset card states them. Licenses are from the dataset card or the publisher’s page, and the two are both recorded when they disagree. This repository does not commit raw rows from any of these sets. `eval/real/README.md` already states that policy for the four sets pinned in `eval/real/sources.json`.

None of these is a labeled corpus of Danish marketplace or MobilePay chats. That gap is why `data/chat-scams/seed.jsonl` exists, and why it is synthetic.

## Use these

### UCI SMS Spam Collection

| | |
|---|---|
| What | Real English SMS, labeled ham or spam. Mostly promotional and premium-rate spam, not multi-turn fraud. |
| Size | UCI record: 5,574 instances. Hugging Face `ucirvine/sms_spam`: 5,574 rows. Hugging Face `codesignal/sms-spam-collection`: 5,572 rows. The two-row gap was not reconciled; prefer the UCI file or `ucirvine/sms_spam` and check a hash. |
| Language | English |
| License | UCI page: Creative Commons Attribution 4.0. The `codesignal` card tag is `cc-by-4.0`. The `ucirvine` card tag is `unknown` even though it is the same collection. The corpus readme embedded on the codesignal card asks for a citation and ships a “no warranty” notice. Treat CC BY 4.0 plus the requested citation as the reuse terms, and do not assume the `ucirvine` card’s “unknown” tag is a different license. |
| Links | [UCI id 228](https://archive.ics.uci.edu/dataset/228/sms+spam+collection), [ucirvine/sms_spam](https://huggingface.co/datasets/ucirvine/sms_spam), [codesignal/sms-spam-collection](https://huggingface.co/datasets/codesignal/sms-spam-collection) |
| Cite | Almeida, T. A., Gómez Hidalgo, J. M., and Yamakami, A. Contributions to the study of SMS Spam Filtering: New Collection and Results. Proceedings of the 2011 ACM Symposium on Document Engineering (DOCENG’11). The corpus readme still says “under review”; the venue and year are what the readme itself asks readers to cite. |
| Fit | Good ham-versus-spam baseline and a source of ordinary English SMS. Weak on romance, marketplace, and Danish. The collection includes a subset drawn from the NUS SMS Corpus; credit Min-Yen Kan as the UCI readme does. This note did not re-check the full NUS corpus terms, so the full NUS set is not listed as reusable here. |
| Caution | Messages are real. Do not commit them. Some ham messages are personal. |

This repo already pins `codesignal/sms-spam-collection` at revision `93ffab6fa47849295146c709e341d169746582f3` in `eval/real/sources.json`.

### BothBosu/scam-dialogue

| | |
|---|---|
| What | Synthetic multi-turn **phone** dialogues, generated with Meta Llama 3 70B Instruct. Columns: `dialogue`, `type`, `label`. |
| Size | 1,600 rows (1,280 train, 320 test) on the datasets server. The card lists four scam types (`ssn`, `refund`, `support`, `reward`) and four non-scam types (`delivery`, `insurance`, `telemarketing`, `wrong`). `eval/real/README.md` reports the file it uses as balanced, 800 scam and 800 non-scam. |
| Language | English |
| License | Apache-2.0, stated on the dataset card |
| Link | [BothBosu/scam-dialogue](https://huggingface.co/datasets/BothBosu/scam-dialogue) |
| Fit | The only widely mirrored set here that is already multi-turn and balanced with hard non-scams (a delivery call, a wrong number). Domain is phone, not SMS or marketplace. Synthetic, so it will not teach current Danish wording. |
| Caution | The card says not to use it for decisions that could harm people. Fine as a research benchmark. Label it synthetic when you train. |

### flowxai/scamguardbench

| | |
|---|---|
| What | Short SMS, email, and chat items with tactic labels and a `legit_confusable` subset (bank one-time codes, courier notices, family money requests that the authors marked legitimate). Versioned; the card says patterns are refreshed and you should cite the version and the manifest hash. |
| Size | Datasets server, all configs: hard 33, legit_confusable 346, standard 598, suspicious 122. Total 1,099. Card size tag is `n<1K`, which is stale relative to that sum. |
| Language | English and Romanian (`en`, `ro`) |
| License | Apache-2.0 |
| Link | [flowxai/scamguardbench](https://huggingface.co/datasets/flowxai/scamguardbench) |
| Fit | Best public set found in this pass for **false positives**. Tactic names overlap this project: `payment_redirect`, `refund_overpayment`, `courier_customs_fee`, `romance_advance_fee`, `family_emergency_impersonation`, `investment_too_good`. Those names are the ones `eval/real/README.md` already uses; confirm them against the version you download. |
| Caution | Mostly synthetic. The card’s sanitization note says the set is written so it can be public. Do not treat a high score here as performance on Danish marketplace chats. `eval/real` uses v0.2 `standard`, English only. |

### wangyuancheng/discord-phishing-scam

| | |
|---|---|
| What | Real Discord chat messages, hand-labeled. Columns include `lable` (spelled that way on the dataset), `msg_content`, timestamps, and features such as `has_link`. |
| Size | 2,000 rows on the datasets server. `eval/real/README.md` describes that file as 278 scam and 1,722 legitimate. 278 + 1,722 = 2,000, so the split matches the row count. |
| Language | English, with some Hindi (card languages: `en`, `hi`) |
| License | MIT (dataset card) |
| Link | [wangyuancheng/discord-phishing-scam](https://huggingface.co/datasets/wangyuancheng/discord-phishing-scam) |
| Fit | Real chat, not SMS. Useful for link-lure and giveaway phrasing. Poor coverage of payment-ask marketplace fraud. |
| Caution | Real user-generated text and Discord identifiers. MIT allows redistribution; this repo still does not commit the messages. Do not join the text to any live account. |

### redasers/difraud (SMS slice only)

| | |
|---|---|
| What | A multi-domain deception bundle. The card’s SMS section is the UCI SMS Spam Collection plus an “SMS Phishing Dataset for Machine Learning and Pattern Recognition”, de-duplicated. |
| Size | Card, SMS section: 6,574 texts, 1,274 deceptive and 5,300 not. The datasets-server size call returned HTTP 501 on 4 November 2026, so the full-bundle row count was not re-counted. The card’s size tag is `10K<n<100K`. |
| Language | English |
| License | MIT, stated on the dataset card (`LICENSE.txt`) |
| Link | [redasers/difraud](https://huggingface.co/datasets/redasers/difraud). An older copy is [difraud/difraud](https://huggingface.co/datasets/difraud/difraud). |
| Fit | A single MIT bundle if you want SMS spam and smishing next to other deception tasks (the card also describes job-post and Twitter-rumour slices). |
| Caution | The upstream “SMS Phishing Dataset” is only named, not separately licensed, on the card text read for this note. Stay with the UCI collection if you need a clean chain of custody. The card’s citation line was still “TODO” when read. |

## Do not treat these as clean training data

### ealvaradob/phishing-dataset

Apache-2.0 on the dataset card. It mixes URLs, HTML, email, and SMS. The SMS portion is described as more than 5,971 messages (489 spam, 638 smishing, 4,844 ham) obtained by running OCR on images found on the internet. That is not a clear license for the underlying messages. Link: [ealvaradob/phishing-dataset](https://huggingface.co/datasets/ealvaradob/phishing-dataset). Use UCI instead for real SMS.

### UniqueData/spam-text-messages-dataset

The card says the preview is an example and that commercial use is paid. Not a free training set. Link: [UniqueData/spam-text-messages-dataset](https://huggingface.co/datasets/UniqueData/spam-text-messages-dataset).

### PreScam and ConScamBench-278

[Sun et al., arXiv:2605.12243](https://arxiv.org/abs/2605.12243) describe PreScam as 11,573 conversational instances filtered from 177,989 user-submitted reports. [Adnan, Manjunath, and Khare, arXiv:2607.11707](https://arxiv.org/abs/2607.11707) say they released ConScamBench-278, eight scam categories, and that they also used a public LoveFraud02 corpus of 83 conversations. This pass did not confirm a download URL or a license for any of the three. They stay in the playbook as research, not as rows to copy.

## This repository’s seed

`data/chat-scams/seed.jsonl` is original synthetic text. `source` is `synthetic` on every row. It is not a sample of the sets above, and it contains no real phone numbers, account numbers, or message dumps. The file has 37 conversations: 18 scam and 19 benign. Danish is 9 and 9. English is 9 scam and 10 benign.

Schema, one JSON object per line:

| Field | Values |
|---|---|
| `id` | Stable string, unique |
| `lang` | `da` or `en` |
| `channel` | `sms`, `whatsapp`, `messenger`, `telegram`, `mobilepay`, `marketplace` |
| `scam_type` | `hi_mum`, `friend_impersonation`, `fake_seller`, `fake_buyer`, `romance`, `investment`, `fake_bank`, `job_mule`, or `benign` |
| `label` | `scam` or `benign`, for the whole conversation |
| `source` | `synthetic` here. A later row taken from a licensed corpus should use that corpus URL and must not be raw personal data |
| `pattern_sources` | Pages in `PLAYBOOKS.md` that the dialogue is modeled on |
| `confusable_with` | On benign rows, the scam type a bag-of-words model might confuse it with. Empty string on scam rows |
| `messages` | `{speaker, stage, text}`. `speaker` is `counterparty` or `user`. `stage` is `hook`, `trust`, `urgency`, `payment_ask`, `move_off_platform`, `recovery`, `reply`, or `benign` |

`research/chat-scams/baseline_tfidf.py` checks this schema before it trains.

## What to download later, and what not to mix

1. Keep ham from UCI as ordinary SMS negatives. Do not call those messages “benign marketplace chats”; they are a different task.
2. Use ScamGuardBench `legit_confusable` as the public false-positive stress test.
3. Use BothBosu as a multi-turn phone test, reported separately from chat.
4. Use the Discord set only for link-lure chat, and strip identifiers before any fine-tune that might be shared.
5. Do not merge these into one accuracy number. A model that catches UCI premium-rate spam can still miss a Danish “hej mor” thread, and a model that flags every MobilePay mention will fail the benign rows in the seed.
