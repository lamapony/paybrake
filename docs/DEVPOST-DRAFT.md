# PayBrake — Devpost draft

**Team:** Dima, Christopher, David

**Video:** [TODO video link]

**Hosted demo:** [TODO hosted demo]

Judges can run the credential-free local mock from the README today. This branch has no public hosted demo and no recorded video. Do not replace the placeholders until those exist.

## Inspiration

A marketplace conversation can look ordinary until a seller asks for a payment method that leaves the buyer with fewer options. We wanted to give someone a moment to reconsider while the request is still in context.

## What it does

PayBrake is a browser extension that looks for evidence of risky payment requests in a supported chat and shows a card explaining the signals. In the included local marketplace demo, the user can start a mock PayPal order for the item, approve it on a mock page and simulate capture. The demo needs no credentials or real payment. PayPal Buyer Protection eligibility depends on its terms; the prototype cannot determine coverage.

## How we built it

A Chrome extension extracts messages from our demo page and applies English and Danish rules on device. A Node.js backend supplies an in-memory mock order flow. An optional model integration can review rule hits when configured. The included pages and fictional chats let judges try the interaction locally.

## Challenges we ran into

Payment language is contextual: an ordinary mention of a payment method is not always a request to pay. We designed the detector to require evidence and included safe conversations to check that it remains quiet. The prototype's patterns can still miss scams or make mistakes.

## Accomplishments that we're proud of

We connected an evidence-based intervention to a complete mock order and approval flow. The offline evaluation is 30 synthetic cases in [eval/cases/pay-risk.json](../eval/cases/pay-risk.json): fictional chats written for this prototype. Run `npm run eval` to reproduce it. That run is a regression check on those 30 cases. It is not a measure of real-world accuracy, and this draft does not quote its scores as field performance.

## What's next

Make the credential-free judge path easier to access ([TODO hosted demo]), validate detection on independently sourced data, and review privacy and site permissions before any real-world pilot. A PayPal sandbox adapter is being developed separately; this branch uses mock orders. The demo video is not recorded yet ([TODO video link]). Record it from [the video script](DEMO-VIDEO-SCRIPT.md) against the local mock, then add captions.
