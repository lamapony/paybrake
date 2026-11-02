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
- Checkout, Goods & Services that the seller actually agreed to, and any other veto atom hide the card even if a strong atom also fired.
- Pay on collection hides the card only when the thread is not also asking for the money up front. It does not hide Friends & Family, MobilePay, or another strong ask that also offers collection. A refusal of the collection phrase ("don't pay on pickup") is not an offer, so it does not hide the ask that follows.
- A prohibition ("never send", "send ikke", "betal ikke", "lad være med at", "skicka aldrig", "betala inte", "ikke send") is not an ask. It covers only the same sentence. A period, question mark, exclamation mark, or newline ends that sentence. A dot inside `kr.` or `500.00` does not, when the next word continues in lowercase. A pivot in that sentence ("don't pay on pickup, only via…", "don't use that, just send…") starts a real ask. The prohibition does not cover the words after the pivot.
- Text under 20 characters is silent. The model is not called for short text, no atom, weak-only, or a veto.
- When a model is configured it may confirm the hit or lower it. It cannot raise the level. Every quote it returns must be a whitespace-normalized substring. A fabricated quote, a `risky: false`, or a transport error never becomes a new card. An error caps a high hit at medium and labels `llm: "error"`.

The buyer still chooses. "Pay anyway" only writes a local log.

## Consequences

Recall is capped by the atom list. New scam wording stays silent until a pattern is added and the eval set still has zero false alarms. That is the trade we want.
