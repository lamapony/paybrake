# Plan for a small on-device chat-scam classifier

> Update 2026-11-05: step 2 (hashed character n-grams + logistic regression) is built and wired into the extension behind the rules. See `train-model.mjs`, `model-results.json`, and the README section "On-device scam model". The model adds a medium card only when the rules found no ask, as this plan required. The plan text below is unchanged.

The detector should run in the browser, on the chat the user already has open, and should stay quiet on ordinary payment talk. This note is a plan and a smoke test. It does not change the extension, and it does not train a model for deployment.

`baseline_tfidf.py` is the smoke test. It reads `data/chat-scams/seed.jsonl` (37 synthetic chats, 18 scam and 19 benign, Danish and English) and writes `baseline-results.json`.

```sh
python3 research/chat-scams/baseline_tfidf.py
```

Requires Python 3 and NumPy. No network, no scikit-learn.

## What the seed run actually did

Protocol, fixed in the script: 5-fold stratified cross-validation, shuffle seed 1105. The vocabulary and the IDF weights are fit on the training fold only. Features are word unigrams and bigrams that occur in at least two training chats, TF-IDF, L2-regularized logistic regression (L2 0.05, 800 steps, class-balanced weights), threshold 0.5. Stage names are not features. A second run sees only the text up through the second counterparty turn.

A lexicon baseline counts a fixed phrase list, taken from `PLAYBOOKS.md` before the run, on counterparty text only. Two or more distinct hits are called scam. The list was not searched over.

| Run | Precision | Recall | F1 | False-positive rate |
|---|---:|---:|---:|---:|
| TF-IDF, full chat | 0.579 | 0.611 | 0.595 | 0.421 |
| TF-IDF, first two counterparty turns | 0.600 | 0.500 | 0.545 | 0.316 |
| Lexicon, at least two hits | 1.000 | 0.500 | 0.667 | 0.000 |

Counts for the full TF-IDF run: 11 true positives, 8 false positives, 7 false negatives, 11 true negatives.

Read those numbers as a smoke test, not as quality.

- The lexicon’s perfect precision is partly by construction. The benign chats were written so they would not contain two of those phrases. A live inbox will. Nine scams are missed because they paraphrase (“MobilePay er nede”, a PayPal Friends and Family line, a verification code) instead of using two listed strings. Missed ids are in `baseline-results.json`.
- TF-IDF does the opposite. It shares words such as MobilePay, gift card, WhatsApp, and “check” across scam and benign rows, so the false-positive rate on this set is 0.42. Several false positives are the hard negatives the seed was built to contain: a pickup paid on the spot, a friend splitting tickets, a bank text that says to call the number on the card, a birthday gift card, a real interview, friends mentioning bitcoin, a WhatsApp photo with payment kept on the listing.
- Probabilities sit near 0.5. Thirty-seven chats are not enough to estimate a stable linear boundary in a few hundred n-grams. Dropping one-chat hapaxes was necessary: with them kept, L2 shrinkage left every probability within a few thousandths of one half.
- Early text is harder (recall 0.50). Several scams do not ask for money until later turns. A model that only looks at the first screen will miss them, which is the right trade if the product would rather wait for a payment ask than interrupt a greeting.

## Features worth building

Single tokens are weak. The seed’s benign half was written to prove that. Features should be combinations, most of them computed only on the counterparty’s turns. The extension already ignores the user’s own lines for rule hits (`eval/real/README.md`); keep that.

**Payment shape, not the word “pay”.**

- Rail: person-to-person MobilePay or a bank transfer, PayPal outside checkout, a wire, a gift-card number plus PIN, cryptocurrency, a check above the price, a “safe account”.
- What is asked for besides money: MitID, a one-time code read back into the chat, a card PIN, online-banking password. Danish police and Europol’s #CyberScams leaflet say a bank does not ask for these. See `PLAYBOOKS.md`.
- Payee mismatch: the name on the request is not the child, the friend, or the seller in the story.
- Timing against handover: deposit or full price before the item is seen; ship against a screenshot; “the money is on its way”.

**Conversation shape.**

- New number, lost or broken phone, “save this number”, and a refusal or inability to take a call on the old number.
- Move to WhatsApp, Telegram, or a private number when the payment itself leaves the listing or the dating app. A photo on WhatsApp with payment left on the listing is the benign pair in the seed (`cs-en-photo-only`).
- Secrecy: don’t tell dad, don’t tell the bank, don’t tell your sister.
- Haste tied to a payment, as distinct from haste tied to a parking app between people who already share a plan.
- Too-good return, a screenshot of profit, a small withdrawal, then a fee to unlock the rest. The last of those is the recovery stage.
- Job whose only duty is receiving and forwarding money, or buying gift cards with a check.

**Negation and repair, so the model can stand down.**

- “Same account as last month”, “it is my name”, “call the number on the card”, “we will not ask for a code”, “no deposit”, “I will bring the physical card”.
- The other person telling you not to send money (`cs-en-parent`).

**Metadata the text does not contain.**

- Whether this number or profile has spoken with the user before.
- Whether the marketplace still holds the checkout.
- Language. Danish and English need to be scored together. Code-switching (“MobilePay”, “PayPal”, “MitID” inside either language) is normal and is not a signal.

Do not use the stage field as an input. It is a label for analysis. A production model has to infer the stage from text.

## Model, in the order to try it

**1. Keep a phrase layer, and do not let a model outvote it upward.**

The lexicon above is that layer in miniature: high precision on the phrases it knows, blind to paraphrase. PayBrake’s existing rules are the same idea aimed at payment requests. Until a model has a measured false-positive rate on real marketplace chats, it should only be allowed to confirm a rule hit or to lower it. That is already how the extension treats its server-side check. This plan does not change that code.

**2. Hashed character n-grams plus logistic regression, on device.**

Word TF-IDF lost to paraphrases and to shared payment words. Character n-grams (3 to 5) handle Danish endings and spelling noise better, and hashing them to a few tens of thousands of bins keeps the model a JSON blob of weights with no embedding file. The training code can stay as small as `baseline_tfidf.py`. Export the weights and score in the extension with the same preprocessing. This is the right first learned model. It is still a linear model: it will not understand “pay me when you are holding the lamp” versus “pay me before you see it” unless those contrasts are frequent in the training text.

**3. A distilled multilingual encoder, only if the linear model plateaus.**

Candidates to evaluate, not models already trained here:

- A distilled multilingual Transformer small enough to ship beside the extension and run in the browser (int8). Multilingual DistilBERT-class models and multilingual MiniLM-class models are the size band to measure. Reject anything that needs a network call at score time if the promise is on-device.
- Train the student on public rows listed in `datasets.md`, with the domain split kept: UCI SMS as a “does spam detection transfer?” check, ScamGuardBench `legit_confusable` as the false-positive set, BothBosu as phone dialogues reported separately. The synthetic seed is for error analysis and for Danish wording those corpora do not have. It is not a training set.
- Distillation target: the student should match the teacher’s *abstention*, not only its positive labels. A chat with no payment ask should score low even when the topic is money.

Do not fine-tune on raw Discord or SMS rows inside this repository. `datasets.md` records the licenses and the personal-data caution. Do not scrape live chats.

## How to evaluate

Report these separately. A single accuracy that mixes UCI spam with marketplace chats will look better than the product is.

| Slice | Why |
|---|---|
| Conversation-level precision, recall, F1, and false-positive rate | The decision the card has to make |
| False-positive rate on hard benign only (`confusable_with` not empty, and ScamGuardBench `legit_confusable`) | Ordinary payment talk is the failure that matters |
| Recall after 1, 2, and 3 counterparty turns, and recall once a payment ask is present | Early warning versus waiting for the ask |
| Danish and English separately | A model can pass English SMS and miss “hej mor” |
| Per `scam_type` | Romance and a mule job do not share a wording |
| Public sets, each alone | UCI, BothBosu, ScamGuardBench English, Discord. State the domain in the same sentence as the number |

Pick the threshold from a false-positive budget (for example, at most 5 percent of `legit_confusable` rows), not from the F1 maximum. Publish the probability, not only the bit, so a later threshold change does not require a new model.

The seed cross-validation must not be the number in a release note. Add a held-out slice the feature designer has not read, or accept that 37 rows can only show the plumbing.

## What this plan refuses

- Shipping the linear model from this seed. False-positive rate 0.42 on chats that were supposed to be easy negatives.
- Raising a risk score from a model when the phrase layer is silent, until that false-positive rate is measured on chats the authors of the phrases did not write.
- Training on personal messages, even with a research license, inside the git tree.
- Using stage labels, source URLs, or `confusable_with` as inputs. Those fields exist so errors can be read.
