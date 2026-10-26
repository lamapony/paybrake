# PayBrake on real scam messages: results

Date: 26 Oct 2026. Branch `eval-real-scams` (from `tester-friendly`). Harness: `eval/real/`.

## What we tested

PayBrake's own eval is 30 chats we wrote ourselves, where it scores precision 1.0 and recall 1.0. That only shows
the rules match the chats they were written for. So we ran the same detector, with no changes, on four public
Hugging Face datasets that other people built and labelled:

| dataset | license | what it is | lang | sampled scam / legit |
|---|---|---|---|---|
| [codesignal/sms-spam-collection](https://huggingface.co/datasets/codesignal/sms-spam-collection) | CC-BY-4.0 | **real** SMS (UCI SMS Spam Collection, 5,574 msgs) | EN | 500 / 500 |
| [wangyuancheng/discord-phishing-scam](https://huggingface.co/datasets/wangyuancheng/discord-phishing-scam) | MIT | **real** Discord chat, hand-labelled (2,000 msgs) | EN (few HI) | 277 / 500 |
| [BothBosu/scam-dialogue](https://huggingface.co/datasets/BothBosu/scam-dialogue) | Apache-2.0 | synthetic multi-turn phone dialogues (1,600) | EN | 500 / 500 |
| [flowxai/scamguardbench](https://huggingface.co/datasets/flowxai/scamguardbench) v0.2 standard | Apache-2.0 | mostly synthetic SMS/email/chat with hard "looks scary but legit" cases (370 EN) | EN (RO dropped) | 150 / 220 |

We sampled 3,147 messages with a fixed seed (20261026), then split each dataset 50/50 into dev and test.
Revisions are pinned. We commit the download script and the per-message predictions, not the raw text.

**Most important caveat: none of these are marketplace buyer/seller chats.** We found no public dataset of those.
PayBrake only looks at *how a payment is being requested*: Friends & Family, upfront deposits, off-platform rails
(bank transfer, IBAN, gift cards, crypto), and paying before seeing the item. Most SMS spam (premium-rate prizes),
Discord scams (fake Nitro links) and phone scams (tech support, SSN) never ask for a payment that way, so they are
outside what PayBrake is built to catch. Low recall on them is expected. The useful questions are:
(a) does PayBrake raise false alarms on real, ordinary messages, and (b) does it catch the scams that *do* ask for money?

## Headline numbers (rules only, unchanged rules v1, all 3,147 sampled messages)

| dataset | TP | FP | FN | TN | precision | recall | F1 | false-positive rate |
|---|---|---|---|---|---|---|---|---|
| SMS spam (real) | 0 | 0 | 500 | 500 | n/a | 0.00 | 0.00 | 0.000 |
| Discord (real) | 11 | 0 | 266 | 500 | 1.00 | 0.04 | 0.08 | 0.000 |
| Scam dialogues | 135 | 0 | 365 | 500 | 1.00 | 0.27 | 0.43 | 0.000 |
| ScamGuardBench | 14 | 6 | 136 | 214 | 0.70 | 0.09 | 0.17 | 0.027 |
| **pooled** | **160** | **6** | **1267** | **1714** | **0.96** | **0.11** | **0.20** | **0.003** |

- **False alarms are rare.** 6 of 1,714 legit messages were flagged (0.35%). Across 1,000 real SMS and 500 real Discord
  messages there were none. 4 of the 6 are ScamGuardBench "family money request" texts ("Hi it's me, lost my phone,
  send 150 to my IBAN"). The dataset calls these legit, though in practice they look exactly like the "Hi Mum" scam.
- **Recall is low (11%) and should be read that way.** It is not a general scam filter.
- **Part of the v1 recall was luck.** 123/123 "reward" phone scams were flagged because the text contains "gift card".
  In most of them the gift card is the *prize* ("you've been selected to receive a $500 gift card"), not the payment
  method. That is the right label for the wrong reason, and the same rule would fire on an honest seller offering a gift card.
- **On scams that do ask for money** (ScamGuardBench's own tactic labels: payment redirect, advance fee, customs fee,
  family emergency, overpayment, investment), v1 caught only **12 of 55 (22%)**. The main reason was a bug: IBANs written
  in the usual groups of four ("RO00 XXXX 0000 …") were not recognised, and "transfer" did not count as a payment word.

## Rule changes (RULES_VERSION 2), designed on dev only, reported on test

Changes in `extension/lib/atoms.js` and `extract.js`, all aimed at the payment request itself:
1. Match IBANs written with spaces, plus "to our secure / safe / new account".
2. Treat "transfer" and "transferred" as payment words (the Danish list already had "overfør").
3. A gift card *offered as a prize* ("receive / win / free / claim … gift card") no longer counts as a payment method.
   Store cards (Steam, Google Play, iTunes, Apple, Amazon, eBay) used as payment do count.
4. "Your account number: XXXX" on a bill or receipt is the reader's own account, not a payee, so it does not fire.
5. Added Zelle, Cash App, Venmo, Western Union, MoneyGram and money orders as off-platform rails. These are chosen
   from the domain, not from the data: they occur almost nowhere in these datasets and changed nothing measurable.
6. £ / GBP / "pounds" are parsed as amounts.

The 30 synthetic chats still score 1.0 / 1.0 with 0 false alarms, and the unit tests pass (108, including 6 new tests for v2).

**Test split only (1,573 messages the rule changes were not designed on):**

| dataset | rules | TP | FP | FN | TN | precision | recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|---|
| SMS spam | v1 | 0 | 0 | 250 | 250 | n/a | 0.00 | 0.00 | 0.000 |
|  | v2 | 0 | 0 | 250 | 250 | n/a | 0.00 | 0.00 | 0.000 |
| Discord | v1 | 5 | 0 | 133 | 250 | 1.00 | 0.04 | 0.07 | 0.000 |
|  | v2 | 5 | 0 | 133 | 250 | 1.00 | 0.04 | 0.07 | 0.000 |
| Scam dialogues | v1 | 67 | 0 | 183 | 250 | 1.00 | 0.27 | 0.42 | 0.000 |
|  | v2 | 22 | 0 | 228 | 250 | 1.00 | 0.09 | 0.16 | 0.000 |
| ScamGuardBench | v1 | 6 | 4 | 69 | 106 | 0.60 | 0.08 | 0.14 | 0.036 |
|  | v2 | 11 | 2 | 64 | 108 | 0.85 | 0.15 | 0.25 | 0.018 |
| **pooled** | v1 | 78 | 4 | 635 | 856 | 0.95 | 0.11 | 0.20 | 0.005 |
|  | **v2** | **38** | **2** | **675** | **858** | **0.95** | **0.05** | **0.10** | **0.002** |

Money-asking scams in the ScamGuardBench test split: v1 **5/31 (16%)**, v2 **11/31 (35%)**. Over all 55: 12 → 27 (49%).

On pooled test, recall drops (0.11 → 0.05). That drop is entirely the "gift card as prize" matches going away, and
we think it is the honest number. On the scams that ask for a payment, recall roughly doubles, and false alarms
are halved.

Test-set honesty note: when we first listed false positives, the printout included all 6 FPs, 4 of them from test,
before we designed change 4. Change 4 was written for the dev receipt FP; it also removes one test FP (a water-bill
reminder). The other changes come from dev false negatives only.

## Rules + LLM (gpt-4o-mini via OpenRouter, 200-message stratified test subsample, v2 rules)

| on the same 200 test messages | TP | FP | FN | TN | precision | recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| rules only | 11 | 1 | 89 | 99 | 0.92 | 0.11 | 0.20 | 0.01 |
| rules + LLM (as shipped: LLM only asked when rules fire, can only confirm/lower) | 10 | 1 | 90 | 99 | 0.91 | 0.10 | 0.18 | 0.01 |
| LLM alone on every message (not how the product works) | 85 | 3 | 15 | 97 | 0.97 | 0.85 | 0.90 | 0.03 |

- As shipped, the LLM cannot add recall: it only sees messages the rules already flagged. Here it vetoed 1 true scam
  (a refund-scam dialogue) and kept the one FP (a "family money request" with an IBAN).
- Asked on every message, the same prompt catches 85% of scams with 3 false alarms out of 100. Two of the three are the same
  disputed "family money request" texts; the third is a real SMS with a link. That is the headroom, but it costs an API
  call per message and sends every chat to a model provider, which is a privacy and cost trade-off.
- Cost: about $0.03 for both LLM runs together (≈425 calls). 1 call errored out of 212 in the v2 run.

## Error analysis (v1 rules; examples from the dev split unless marked)

**10 representative false negatives**
1. `sms_spam:4991`: "…selected to receive a £350 award… call 0871…". Premium-rate prize spam with no payment method in it. Out of scope.
2. `sms_spam:5566`: "REMINDER FROM O2… reply with your valid name, house no and postcode". Data harvesting. Out of scope.
3. `discord:1978`: "You've received 1 month of free Nitro! Claim it… https://discord-nitro-gifts…". Link phishing; PayBrake has no URL or lookalike-domain signal.
4. `discord:1064`: "Made a tool that adds free Discord themes, install here: …". Malware lure. Out of scope.
5. `scam_dialogue:402`: "Windows Technical Support… virus on your computer…". Tech support / remote access. No payment rail named.
6. `scam_dialogue:32`: "Officer Johnson from the Social Security Administration…". Asks for an SSN, not a payment.
7. `scamguardbench:5f5c39bc`: "your bank's Security Operations Center… confirm your identity within 24 hours". Credential phishing.
8. `scamguardbench:9390d113`: "we have identified an overpayment of $450… confirm your card details". Overpayment refund plus card details. Asks for money but names no rail.
9. `scamguardbench:5ac5b1d4`: "Mom… in hospital… transfer immediately to RO00 XXXX 0000 …". In scope, but v1 missed the spaced IBAN. **Fixed in v2.**
10. `scamguardbench:b9a906db`: "customs fee of €4.99 is required. Click here to pay now". In scope (fee via link), still missed in v2: "pay via a link" is not a signal.

**All false positives found (there are only 6 rule FPs and 3 LLM-alone FPs, so these are all of them, plus one near miss)**
1–4. `scamguardbench` family_money_request ×4 (`947184f3`, `c910ec39`, `67997e6f`, `b2fb2e65`): "lost my phone… send 150 to my IBAN". The dataset labels these legit; we would argue a warning is useful here. 3 remain in v2.
5. `scamguardbench:5ecd897f` (dev): subscription receipt, "Account Number: XXXX-7849" was read as a payee. **Fixed in v2** (reader's own account).
6. `scamguardbench:d0c84375` (test): water-bill reminder, "Your account number: WC-789456". **Fixed in v2** by the same change.
7. LLM alone `sms_spam:55`: "Do you know what Mallika Sherawat did yesterday? Find out now @ <URL>". A real ham message that looks like clickbait.
8–9. LLM alone: the same disputed family-money texts as 1–4.
10. Near miss: `scam_dialogue:607` is a scam, but v2 flags it because of the *victim's* line "can you transfer me to your supervisor… this amazing gift card". That is the right label for the wrong reason. It shows that (a) the rules don't care who is speaking, and (b) "transfer" can mean a phone transfer.

## Top weaknesses

1. **Narrow scope.** No signal for links or lookalike domains, credential or OTP requests, remote-access apps, impersonation of banks or government, or "pay this fee via the link". This is why recall is near zero on SMS and Discord.
2. **Keyword matching without roles.** Signals fire on whoever says the phrase, including the victim. Gift cards were matched as prizes until v2.
3. **Format brittleness.** Spaced IBANs, "transfer" and £ amounts were all missed in v1. Similar gaps probably remain for other real-world formats (other currencies, sort codes written without the words "sort code").
4. **The LLM is wired as a confirmer only.** In the product it can only remove alerts. It is accurate standalone, but today it is never asked about messages the rules missed.
5. **No marketplace ground truth.** The scope PayBrake is actually designed for (F&F, deposits, ship-only sellers) is still measured only on our own 30 chats.

## Suggested next steps (not done)

- Add a link/domain atom (weak) and a "pay via link / fee to release" atom (strong only together with an amount), designed on dev and measured on test.
- Add a speaker-aware gate: only the counterparty's messages can raise strong signals.
- Optional "LLM second opinion when rules are silent" for messages that mention money (an amount or a payment word). Measure its cost and false-alarm rate.
- Build a small held-out set of **real marketplace** scam chats (e.g. donated screenshots, public warning posts from DBA/Facebook Marketplace/Vinted help pages), labelled by someone who did not write the rules.

## Reproduce

```
npm run eval:real:download && npm run eval:real
OPENROUTER_API_KEY=… node eval/real/run-real.mjs --llm --llm-n=200
```
Results: `eval/real/results/rules-v1.json` (baseline, from the original rules), `rules-v2.json`, `llm-v1.json`, `llm-v2.json`.
