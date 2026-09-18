---
description: One sales order's whole story. The lines with how each was priced, what shipped and when, what is short and why, what is billed, and the notes.
---

1. Run `npm run wholesale -- so <ref>` with whatever the operator gave you: the order number, the customer's reference, or a customer name (ambiguity lists candidates).
2. Read the card before answering anything about the order. The `Priced off` column says where every price came from; `NOTHING MATCHED` means the line is at $0.
3. If lines are short, say the honest position from `backorders`: how many, what is inbound and when, or that nothing is on order.
4. The next action is usually one of: `ship <so>`, `order add`, `hold`/`release`, or `bill <customer>` once shipped.
