# PayBrake

**Tagline:** Brakes before you pay.

## The problem

A marketplace deal can move from a friendly chat to a request for a deposit, an irreversible transfer, or a verification code. Buyers have to assess the request at the moment they are about to act, often under pressure.

## What it does

PayBrake is a browser extension that checks a supported marketplace-style chat on the device and shows a small card when it finds concrete evidence of a risky request. It identifies the matching text and offers a route to a PayPal order or the option to dismiss the warning. Ordinary collection-and-payment chats should stay quiet. The current main-branch demo runs on a fictional store; it does not support real marketplace sites.

## How we built it

The Chrome MV3 extension uses English and Danish rule patterns, a background service worker, and a card in a shadow DOM. An optional backend model check can confirm or lower a rule-based finding. A Node backend supplies an order interface and a mock approval and capture flow. The main branch currently uses mock orders; real PayPal sandbox and configured AI integration must be validated before claiming them in the submission.

## Challenges

Keeping the card quiet on ordinary conversations while catching varied scam wording requires careful evidence and negative examples. Connecting a payment flow also means preserving the difference between a mock order, a sandbox transaction, and Buyer Protection that may be eligible under PayPal's terms.

## Accomplishments

We built a runnable extension and demo with evidence-based warnings, local override logging, a mock order flow, offline tests, and an evaluation set. The nine roleplay examples include an honest seller as a silent control.

## What's next

Review and integrate the existing sandbox and hosted work, verify the AI and PayPal flows end to end, expand evaluation with consented and representative examples, and build adapters for real marketplace pages.

## Team

Dima — extension, detection, demo and submission. Christopher — backend and payment integration. David — TODO: confirm role.

## Links

- Repository: TODO (public URL when approved)
- Demo: TODO (confirm submission URL and deployed version)
- Video: TODO
- Devpost: TODO
