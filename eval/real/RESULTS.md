# PayBrake on real scam messages: results

Date: 26 Oct 2026. Branch `eval-real-scams` (from `tester-friendly`). Harness: `eval/real/`.

**Latest: rules v3 + the AI check on Typesafe (jev-1.14.0), see [the Typesafe section](#v3--typesafe-ai-replaces-openrouter-as-the-ai-provider). Before that: rules v3 + OpenRouter, see [the v3 section](#v3-new-rules-and-the-ai-check-on-all-chats).** The sections before it describe v1/v2 and are kept as the baseline.

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

## v3: new rules and the AI check on all chats

### What changed

**Rules (RULES_VERSION 3, `extension/lib/atoms.js`).** Six new signals, designed on dev only:
- `credential_request` (strong, enough alone): asks for card number / CVV / expiry, one-time / SMS / verification codes,
  MitID / NemID / BankID codes or logins, passwords, PINs, CPR / SSN, bank login or account details. Needs a request verb in the
  same sentence. "Never share this code", "use the official app", "the number on the back of your card" do not fire.
- `remote_access` (strong, alone): AnyDesk, TeamViewer, QuickSupport, Quick Assist, RustDesk and similar, or "remote access /
  screen share" with an install/give/allow verb.
- `phishing_link` (strong, alone): a link whose host is a shortener, raw IP, punycode, a lookalike of a brand (`paypa1`, `dlscord`,
  edit distance 1–2), a brand name inside a stranger's domain, an odd TLD (`.xyz`, `.top`, `.gift` …) or a lure word in the site
  name (`prize-verify.`, `secure-pay-check.`), with a lure word nearby (verify, log in, claim, pay …). Official domains are
  exempt; plain service subdomains (`support.`, `help.`, `billing.`) are not lures. Also "click here to verify / pay" and
  "receive the payment via this link".
- `fee_via_link` (strong, alone): customs / delivery / release / processing fee, or "pay a small fee", together with a link,
  prize, parcel-held or refund context.
- `impersonation` and `account_threat` (weak): "this is your bank / fraud department / Skattestyrelsen / support team",
  "your account will be suspended", "unusual login", "virus detected". They raise a card only together with another signal.
- **Speaker gate:** only the other person's lines raise signals. The user's own line ("can I pay with my card number?") never does.

**AI check on all chats** (`extension/lib/pay-risk.js` `combineAll`, `extension/background.js`, `extension/content.js`).
- Before: the model was asked only after the rules fired and could only confirm or lower a card.
- Now: rules run first and show a card at once. About 0.8 s after the chat stops changing, the chat is sent to the AI check.
  Each chat text (hash) is checked once and the answer is cached.
- Show a card if either one says risky:
  - Rules risky + AI risky: the higher level, AI signal added.
  - Rules risky + AI not risky: the card goes away only if the AI's confidence is at least 0.85. Otherwise it stays, marked "AI check unsure".
  - Rules silent + AI risky with confidence at least 0.8: the AI adds a card (signal from the AI, receipt "Flagged by the AI check").
    One exception: a code notice that tells the user never to share the code, and does not ask for it, stays silent.
  - A Goods & Services veto is overridden only by a high-risk verdict with confidence at least 0.9.
- The AI's evidence must be a verbatim quote from the other person's lines, or it is ignored.
- **Redaction before sending:** emails, phone numbers (8+ digits), IBANs (all but the last 4 characters), Luhn-valid card numbers,
  CPR / SSN, and codes after "code / kode / OTP / PIN / password" are masked. Lines are labelled `Them:` / `Me:`.
- **Timeout:** 6 s. On timeout or error the rules verdict stands and the card says **AI check unavailable**. Those answers are not cached.
- **Server without AI (the hosted test server):** the extension reads `/health`. If the server has no AI provider, no chat text is sent,
  and the card says **AI check off (mock server)**. No key was added to the Worker.
- **Setting:** "AI check on all chats" in Settings, ON by default in this demo build. Settings and the welcome tab explain what is
  sent and where, and Settings shows whether the current server has AI. Off means rules only, and no chat text leaves the browser.

Thresholds were picked on dev (sweep in `results/llm-all-v3-dev-all.json`): downgrade confidence made no difference at any value from
0.7 to 1.01 (the model almost never says "not risky" with high confidence when rules fire). Add confidence 0.8 gave the same F1
as 0.5 with slightly fewer false alarms; 0.9 cost 14 points of recall.

### Before / after, test split (1,573 messages none of the changes were designed on)

| pooled test | TP | FP | FN | TN | precision | recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| rules v1 | 78 | 4 | 635 | 856 | 0.95 | 0.11 | 0.20 | 0.005 |
| rules v2 | 38 | 2 | 675 | 858 | 0.95 | 0.05 | 0.10 | 0.002 |
| **rules v3** | **325** | **7** | **388** | **853** | **0.98** | **0.46** | **0.62** | **0.008** |
| **rules v3 + AI check on all chats** ¹ | **606** | **39** | **107** | **821** | **0.94** | **0.85** | **0.89** | **0.045** |

¹ The OpenRouter account ran out of credit (HTTP 402) during the test run. 305 of 1,573 rows (198 phone dialogues,
106 ScamGuardBench, 1 Discord) got no AI answer and fell back to rules only, exactly as the product does on a timeout.
On the 1,268 rows that did get an AI answer:

| test rows with an AI answer (1,268) | TP | FP | FN | TN | precision | recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| rules v3 | 236 | 6 | 379 | 647 | 0.98 | 0.38 | 0.55 | 0.009 |
| rules v3 + AI check on all chats | 517 | 38 | 98 | 615 | 0.93 | 0.84 | 0.88 | 0.058 |
| AI alone (v3 prompt) | 445 | 41 | 170 | 612 | 0.92 | 0.72 | 0.81 | 0.063 |

Per dataset, test split:

| dataset | rules v3 P / R / FPR | rules v3 + AI P / R / FPR |
|---|---|---|
| SMS spam (real) | n/a / 0.00 / 0.000 | 0.97 / 0.78 / 0.024 |
| Discord (real) | 0.97 / 0.23 / 0.004 | 0.94 / 0.72 / 0.024 |
| Scam dialogues | 0.99 / 0.90 / 0.008 | 0.96 / 0.96 / 0.036 ¹ |
| ScamGuardBench | 0.95 / 0.92 / 0.036 | 0.80 / 0.96 / 0.164 ¹ |

**Same 200-message test subsample as the v1/v2 LLM runs** (no credit problem here, 1 of 200 calls failed):

| on the same 200 test messages | TP | FP | FN | TN | precision | recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| v2 rules only | 11 | 1 | 89 | 99 | 0.92 | 0.11 | 0.20 | 0.01 |
| v2 rules + LLM (confirm only, as shipped before) | 10 | 1 | 90 | 99 | 0.91 | 0.10 | 0.18 | 0.01 |
| v2 prompt, LLM alone | 85 | 3 | 15 | 97 | 0.97 | 0.85 | 0.90 | 0.03 |
| **v3 rules only** | **56** | **2** | **44** | **98** | **0.97** | **0.56** | **0.71** | **0.02** |
| **v3 rules + AI check on all chats** | **91** | **13** | **9** | **87** | **0.88** | **0.91** | **0.89** | **0.13** |
| v3 prompt, AI alone | 78 | 15 | 22 | 85 | 0.84 | 0.78 | 0.81 | 0.15 |

The subsample has 25 legit messages per dataset, and ScamGuardBench's legit half is deliberately "looks scary but is fine", so
its FPR is much higher than in real traffic. Read the full-test FPR (0.045) as the better estimate, and the SMS / Discord
FPR (0.024 each, real messages) as the closest to real use.

**The v3 prompt is worse alone than the v2 prompt on these 200** (FP 3 → 15, recall 0.85 → 0.78). The new prompt lists many
more risky asks (links, codes, impersonation), and the model now flags bank notices, courier notifications and OTP messages that
are legit. Rules + AI still beats both on recall, but most of the new false alarms come from the AI. Fixing the prompt is the first
open item below.

### Where the AI's false alarms come from (dev split, 49 FPs with rules + AI)

- ScamGuardBench confusables (25): bank transaction alerts read as impersonation, government / courier / subscription notices with a
  link read as phishing, the disputed "family money request" texts. The code-notice exception removed 9 OTP notices.
- Phone dialogues (12): legit delivery and insurance calls asking to "confirm your details".
- Real SMS / Discord (12): clickbait links, "send me your number", friends talking about payments.

### Cost and latency

- **Cost: $0.35** on the OpenRouter key (`/api/v1/key` usage 13.899 → 14.252), about 3,300 calls with gpt-4o-mini
  (dev 1,574, test 200, test-all 1,268 answered). About $0.10 per 1,000 chats.
- **Latency** of one AI check, measured from the box straight to OpenRouter (the product adds one hop through the PayBrake server):
  p50 **2.0 s**, p95 **3.2–3.5 s**, max 7.4 s. The rules card appears at once. The AI result arrives about 3 s later (0.8 s debounce + p50).
  Above the 6 s timeout, the card says "AI check unavailable".
- Not done: a full test run with every row answered. That needs about $0.04 more credit on the OpenRouter account.

### Rules v3 on dev (for reference, what the rules were designed on)

pooled dev: TP 328, FP 3, FN 386, TN 857, precision 0.99, recall 0.46. The 3 dev FPs: a telemarketing call ("we'd need a credit card
to put on file"), one disputed family-money text, and an OTP notice with "this is your bank … unusual login" (impersonation +
account threat).

Test-set honesty note: the first v3 draft's printout showed the test split once (pooled P 0.95, R 0.36) before later dev-only fixes.
After that, `run-real.mjs` printed dev only, and every rule and threshold change was made on dev rows. One rule change was prompted by a
product example, not by data: the promo-page quiz message "Pay with this link: paypa1-secure-checkout.example/pay" now fires
(bare domains on common TLDs count when the host itself looks off).

### Open risks

1. **AI false alarms.** FPR 4.5% on test overall, 2.4% on real SMS and Discord, 16% on ScamGuardBench's hard legit set. Bank alerts,
   courier notices and "confirm your details" calls are the main sources. Next: revise the prompt on dev, for example by requiring an
   actual ask (pay / send / click / install) from Them before "risky", and re-measure.
2. **Privacy.** With the setting on, every chat (redacted) goes to the PayBrake server and on to the AI provider. Redaction is regex-based:
   names, street addresses and free-text details are not masked, and the phone rule also masks long order numbers.
3. **The hosted test server now has AI (Typesafe, 26 Oct).** `hosted/src/index.js` calls the same `classifyText` as the backend with a fixed
   config (jev-1.14.0, add bar 0.5, 6 s timeout), masks the text again server-side (the mask is idempotent on all 9,542 eval transcripts), caps
   text at 4,000 characters and bodies at 16 KB, and limits `/api/classify` to 30 calls per minute per IP (Durable Object, strict; plus the
   approximate Workers rate-limit binding) and 20,000 per day overall. Any provider error is a 502 and the extension keeps the rules result.
   Live check: `node tests/e2e/hosted-ai-live.cjs` (screenshots in `shots/ai-live/`).
4. **Credit.** The OpenRouter account behind the eval key returned 402 (out of credit) at the end of this run. The AI check now runs on Typesafe (see below).
5. **Labels.** Some dataset labels are debatable (family money requests), and none of this data is marketplace chat.
6. **SMS prize spam** (premium-rate numbers, no link or payment ask) is still out of scope for the rules. Only the AI catches it.

## v3 + Typesafe AI (replaces OpenRouter as the AI provider)

Date: 26 Oct 2026. Same rules v3, same test split, same redaction and speaker labels. Only the AI provider changed.

**What Typesafe is.** [TypeSafe](https://docs.typesafe.ai) serves *decision models* (Jev), not chat models. The API is
`POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>` ([API reference](https://docs.typesafe.ai/api),
[models](https://docs.typesafe.ai/models)). It is **not** OpenAI-compatible: you send the content as `state` plus typed questions
(`noul` = yes/no probability, `choice`, `score`) and get back probabilities. It writes no free text. `GET /v1/models` lists
`jev-latest` and `jev-preview` (both → `jev-1.14.0` today); `jev-1.13.0` is also accepted. Price: $0.042 per million input
tokens, output free.

**How PayBrake uses it** (`backend/src/classify.js`, `LLM_PROVIDER=typesafe` or just `TYPESAFE_API_KEY` set):
- One call per chat with three questions: `risky` (yes/no, with the same "what counts as risky / not risky" text as the chat prompt),
  `signal` (choice of PayBrake's signal ids) and `evidence` (choice of one of Them's lines, by index).
- The evidence is that line verbatim, so it always passes the quote guard and the model cannot invent a quote. The card text comes from
  PayBrake's own templates (the model writes no reason).
- `confidence` = p(risky) for a risky verdict, 1 − p for a safe one. Typesafe's probabilities run lower than gpt-4o-mini's self-reported
  confidence, so the server sends `addConfidence: 0.5` with each answer and the extension uses it as the add bar (an explicit option still
  wins; the hint can never go below 0.5). The clear bar stays 0.85.
- Configurable by env: `TYPESAFE_API_KEY_NAME`, `TYPESAFE_BASE_URL`, `TYPESAFE_MODEL` (default pinned `jev-1.14.0`),
  `TYPESAFE_ADD_CONFIDENCE`. `LLM_PROVIDER=openrouter` still selects OpenRouter, and `LLM_FALLBACK=openrouter` retries a failed
  Typesafe call on OpenRouter.

**Model and threshold choice (dev split only, 1,574 messages, sweep in `results/llm-all-v3-dev-all-typesafe-*.json`):**

| dev, rules v3 + AI | add bar | TP | FP | precision | recall | FPR | p50 / p95 latency |
|---|---|---|---|---|---|---|---|
| jev-1.14.0 | 0.8 | 382 | 5 | 0.99 | 0.54 | 0.006 | 66 / 114 ms |
| jev-1.14.0 | 0.7 | 410 | 8 | 0.98 | 0.57 | 0.009 | |
| **jev-1.14.0** | **0.5** | **493** | **14** | **0.97** | **0.69** | **0.016** | |
| jev-1.13.0 | 0.5 | 482 | 14 | 0.97 | 0.68 | 0.016 | 61 / 122 ms |

Picked **jev-1.14.0 at add bar 0.5**: higher recall than 1.13.0 at the same false alarms, same speed. The clear bar (0.7 to 1.01)
changed at most one row. The prompt was not tuned (false alarms were well below 4.5%).

### Test split, 1,573 messages, measured once

| pooled test | TP | FP | FN | TN | precision | recall | F1 | FPR | no AI answer |
|---|---|---|---|---|---|---|---|---|---|
| rules v3 | 325 | 7 | 388 | 853 | 0.98 | 0.46 | 0.62 | 0.008 | n/a |
| rules v3 + OpenRouter gpt-4o-mini (previous) | 606 | 39 | 107 | 821 | 0.94 | 0.85 | 0.89 | 0.045 | 305 (402 out of credit) |
| **rules v3 + Typesafe jev-1.14.0** | **498** | **13** | **215** | **847** | **0.97** | **0.70** | **0.81** | **0.015** | **0** |
| Typesafe alone | 488 | 11 | 225 | 849 | 0.98 | 0.68 | 0.80 | 0.013 | 0 |

On the 1,268 rows where OpenRouter did answer: Typesafe P 0.98 / R 0.65 / FPR 0.012 against OpenRouter's 0.93 / 0.84 / 0.058.

| dataset (test) | rules v3 P / R / FPR | + OpenRouter P / R / FPR | + Typesafe P / R / FPR |
|---|---|---|---|
| SMS spam (real) | n/a / 0.00 / 0.000 | 0.97 / 0.78 / 0.024 | 1.00 / 0.45 / 0.000 |
| Discord (real) | 0.97 / 0.23 / 0.004 | 0.94 / 0.72 / 0.024 | 0.97 / 0.47 / 0.008 |
| Scam dialogues | 0.99 / 0.90 / 0.008 | 0.96 / 0.96 / 0.036 ¹ | 0.99 / 0.98 / 0.008 |
| ScamGuardBench | 0.95 / 0.92 / 0.036 | 0.80 / 0.96 / 0.164 ¹ | 0.89 / 1.00 / 0.082 |

¹ partly rules only after the 402.

- **Trade-off:** a third of the false alarms (13 vs 39), lower recall (0.70 vs 0.85). Every missed scam is SMS spam (138) or a Discord
  scam (73), plus 4 "reward" phone calls: prize spam and Nitro / free-stuff lures that do not ask for a payment, the part PayBrake calls
  out of scope. **All 31 money-asking ScamGuardBench scams in test are caught** (OpenRouter: 30).
- **The 13 false alarms:** 7 are the disputed ScamGuardBench "family money request" texts (lost phone, send to my IBAN), 2 are hard
  "legit" phishing-style emails with links, 2 are real Discord messages, and 2 are rules hits (delivery, telemarketing calls) that the AI
  did not clear with enough confidence.
- **Latency** (box → Typesafe, 6 parallel calls): p50 **62 ms**, p95 **107 ms**, max **276 ms**, against p50 2.0 s / p95 3.2–3.5 s for
  OpenRouter. No call came close to the 6 s timeout, and no call failed (0 of 1,546). With the 0.8 s debounce the AI result lands under
  1 s after the chat stops changing.
- **Cost:** 1.78 M input tokens for the full test run (~1,150 tokens per chat including the questions) = **about $0.075**, i.e. about
  $0.05 per 1,000 chats. All Typesafe runs today (3 dev, 1 test, probes) were about 7.2 M tokens ≈ $0.30. Typesafe's API does not
  report spend, so this is tokens × list price.
- Not done: a prompt revision to bring back the prize-spam recall. It would need dev-only tuning and a new test measurement.

Reproduce: `LLM_PROVIDER=typesafe TYPESAFE_API_KEY=… node eval/real/run-llm-all.mjs --split=dev --n=all --sweep`, then
`--split=test --n=all`. Add `TYPESAFE_MODEL=jev-1.13.0` to compare versions. Results: `results/llm-all-v3-test-all-typesafe-jev-1.14.0.json`.

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
node eval/real/run-real.mjs --report
OPENROUTER_API_KEY=… node eval/real/run-llm-all.mjs --split=dev --n=all --sweep
OPENROUTER_API_KEY=… node eval/real/run-llm-all.mjs --split=test --n=200
OPENROUTER_API_KEY=… node eval/real/run-llm-all.mjs --split=test --n=all
```
Results: `eval/real/results/rules-v1.json` (baseline, from the original rules), `rules-v2.json`, `rules-v3.json`, `llm-v1.json`, `llm-v2.json`,
`llm-all-v3-dev-all.json` (with the threshold sweep), `llm-all-v3-test-200.json`, `llm-all-v3-test-all.json`.
