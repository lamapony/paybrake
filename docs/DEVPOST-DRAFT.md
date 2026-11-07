# PayBrake — Devpost draft

**Team:** Dima, Christopher, David

**Video:** [TODO video link]

**Hosted demo:** https://paybrake-demo.spbabinov.workers.dev/

Judges can open that hosted demo, or run the credential-free local mock from the README. The video is not recorded yet. Do not replace the video placeholder until it exists. This branch did not redeploy the hosted demo.

## Inspiration

A marketplace conversation can look ordinary until a seller asks for a payment method that leaves the buyer with fewer options. We wanted to give someone a moment to reconsider while the request is still in context.

## What it does

PayBrake is a browser extension that looks for evidence of risky payment requests in a supported chat and shows a card explaining the signals. In the hosted demo and the local marketplace demo, the user can start a PayPal order for the item (sandbox when keys are set, otherwise a mock order), approve it, and simulate capture. The mock path needs no credentials and moves no real money. PayPal Buyer Protection eligibility depends on its terms; the prototype cannot determine coverage.

## How we built it

A Chrome extension reads the demo chat and applies English and Danish rules on the device. Those rules cover PayPal Friends & Family (including reversed phrasing and gift wording), a personal PayPal payment, Wise, Western Union, Venmo, Swish, Zelle, a payment ask that names Telegram or WhatsApp, and upfront, holding-fee, or reserve requests. A Node backend creates the order: PayPal Orders v2 sandbox when credentials are set, otherwise an in-memory mock. An optional server-side model check can confirm or lower a rules hit. It cannot raise one. The hosted demo and the local pages use fictional chats.

## Challenges we ran into

Payment language is contextual: an ordinary mention of a payment method is not always a request to pay. We designed the detector to require evidence and included safe conversations to check that it remains quiet. The prototype's patterns can still miss scams or make mistakes.

## Accomplishments that we're proud of

We connected an evidence-based intervention to a mock order and approval flow, with a PayPal sandbox adapter when keys are set. The offline evaluation is 35 synthetic cases in [eval/cases/pay-risk.json](../eval/cases/pay-risk.json): fictional chats written for this prototype. Run `npm run eval` to reproduce it. That run is a regression check on those 35 cases. It is not a measure of real-world accuracy, and this draft does not quote its scores as field performance.

## What's next

Record and caption the demo video ([TODO video link]) from [the video script](DEMO-VIDEO-SCRIPT.md). Validate detection on independently sourced data before quoting it. Review privacy and the pilot's site permissions before any real-world use. The hosted demo is linked above; confirm it still matches this commit before submission day.
