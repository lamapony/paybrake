# Backlog

Deferred work. Open pull requests stay open until someone reviews them. This list does not merge or close anything.

## Contested detector pulls

#23–#31 are open against `main`. Grok reviews contested each one. A wrong card is worse than a miss (`docs/adr/0001-silent-unless-evidenced.md`).

| PR | Branch | Intent |
|---|---|---|
| #23 | `grok/pb-down-pay-1103` | down payment, booking fee, earnest money |
| #24 | `grok/pb-hold-noun-1103` | "hold the bike for you" when money is asked |
| #25 | `grok/pb-chat-signal-1103` | amount sent via Signal, Discord, or iMessage |
| #26 | `grok/pb-f-and-f-1103` | "F and F" and "Friends n Family" |
| #27 | `grok/pb-my-paypal-1103` | money sent to "my PayPal" |
| #28 | `grok/pb-paysafe-1103` | Paysafecard and Paysafe when money is asked |
| #29 | `grok/pb-store-card-1103` | Amazon and Steam cards that do not say gift |
| #30 | `grok/pb-chat-messenger-1103` | amount sent on Messenger, Facebook Pay, Snapchat, or Viber |
| #31 | `grok/pb-half-upfront-1103` | "half up front" and "50% now" |

The reviews' shared failure is a gate that is too wide: a nearby price, the word "paid", or a refusal still counts as a live ask.

## Known false positives

Recorded as silent cases on #32 (`eval/known-false-positives`). Detectors are unchanged there. Two of the four raise a card on current `main`.

| Case | Seller line | On main now |
|---|---|---|
| `hn-refuse-ff-checkout` | I won't take PayPal F&F, use checkout | **risk** / medium / `friends_family`. "use checkout" is not the checkout veto. "use the checkout" is. |
| `hn-price-whatsapp` | price is 200, text me on WhatsApp | silent. No payment ask. |
| `hn-paid-flat-deposit` | I already paid the deposit for my flat | **risk** / medium / `upfront_deposit`. "paid" counts as a pay word beside "deposit". Small talk, not an ask. |
| `hn-battery-50-now` | battery is at 50% now | silent. The `50% now` rule is not on `main`. #31 adds it, and the review shows a price next to that phrase becomes a card. |

The two failing node tests are `{ todo: true }`. `npm test` stays green. `npm run eval` exits 1 while those two cases fire (precision 0.9, false alarms 2).

## Datasets

#4 (`eval-real-scams`, base `tester-friendly`) is the large-dataset eval. It is still open, stacked on #3, which is stacked on #1. The Hugging Face scam/ham files should stay outside the repo.

#5 merged. It committed `eval/real/` (about 6.7 MB, including the result JSON under `eval/real/results/`). Those files should move out of git. Do not land a second copy from #4.

There is still no eval set of real marketplace chats. #4's sources are SMS, Discord, and synthetic phone dialogues. The in-repo set is the synthetic chats in `eval/cases/pay-risk.json`.

## PayPal sandbox

#1 (`backend-rest`) is still open: rest adapter, toolkit stub, OpenRouter classify. #3 (`tester-friendly`, base `backend-rest`) is the stacked tester demo: hosted mock, welcome tab, ready-to-load zip.

`main` already has rest and toolkit code from the #5 squash, plus a hosted demo. #1 and #3 overlap that work and still need a review before anyone treats them as the next step. `docs/CHRISTOPHER-HANDOFF.md` says no call to PayPal or to a model has been made from this repo. `docs/BACKEND-CONTRACT.md` marks the rest, classify, and toolkit checklists done, and says live sandbox responses are still unverified.

`SPEC.md` names `scripts/live-sandbox.mjs` (create, approve link, capture, skip without credentials). That file is not in the tree.

## Submission and promo drafts

| PR | Branch | What it is |
|---|---|---|
| #2 | `promo-page` | Draft promo landing page under `site/` |
| #6 | `night/1101-audit-fixes` | Audit, roleplay detection fixes, SUBMISSION draft, message shots |
| #7 | `night/1101-submission` | Judge README, demo GIF, Devpost draft, release gate |
| #8 | `grok/pb-qa-r2-1102` | QA round 2. Base is `night/1101-audit-fixes` (#6), not `main` |

## In the code

- `extension/lib/atoms.js`: wire and transfer still miss "to our bank", "to the bank account", "to your account", and Danish/Swedish "overfør" / "överför … til min konto".
- The gift ask does not cover "overfør" or "MobilePay" as the verb.
- `extension/content.js` ships only the demo adapter. The example marketplace row stays commented. Do not ship a real marketplace adapter.
- README TODO: screenshots and GIFs under `shots/` (`shots/tester/`, `shots/tester-v2/`, `shots/tester-v3/`, `shots/ai-live/`) were not regenerated in that checkout. Do not treat them as current. Regenerate with `npm run shots` and `npm run e2e` / `npm run e2e:hosted` where Chromium can launch.
- Issue #21: upfront bare-number and NOK gaps after #17. "I paid upfront…" and "We paid for the repair upfront." still flag; "I paid for the service upfront." does not.
- Issue #22: rail-first asks with no pay word stay silent after #20 ("Venmo me now…", "Zelle me now…"). Some tests lock those misses in as silent.
- Atoms are English and Danish. A few Swedish rail lines exist. Other wording stays silent on purpose.
- Mock orders live in memory on one Node process. A live sandbox order has not been created from this repo.
