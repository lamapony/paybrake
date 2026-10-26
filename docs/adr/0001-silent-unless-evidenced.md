# ADR 0001: Silent unless a span is evidenced

## Status

Accepted. Rules version 1.

## Context

PayBrake sits in a marketplace chat and can suggest moving a deal to a PayPal Goods & Services order. A wrong card is worse than a missed one: the buyer learns to ignore it, or we accuse an ordinary sentence. The phrases we care about also appear in harmless talk ("my friends and family loved it", "bottle deposit", "pay when you pick it up").

## Decision

The card stays hidden unless a regex atom matches a concrete span in the text.

- Strong atoms are payment rails and upfront money: Friends & Family, a deposit, an off-platform rail, pay-before-you-see.
- Weak atoms (hurry, ship-before-you-meet) never open a card alone.
- One strong atom, plus a pay word or an amount in that same message, is medium.
- Two strong atoms, or one strong and one weak, is high.
- Any veto (pay on collection, checkout, or Goods & Services that the seller actually agreed to) hides the card even if a strong atom also fired.
- Text under 20 characters is silent. The model is not called for short text, no atom, weak-only, or a veto.
- When a model is configured it may confirm the hit or lower it. It cannot raise the level. Every quote it returns must be a whitespace-normalized substring. A fabricated quote, a `risky: false`, or a transport error never becomes a new card. An error caps a high hit at medium and labels `llm: "error"`.

The buyer still chooses. "Pay anyway" only writes a local log.

## Consequences

Recall is capped by the atom list. New scam wording stays silent until a pattern is added and the eval set still has zero false alarms. That is the trade we want.
