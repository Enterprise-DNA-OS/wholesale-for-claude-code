---
description: Everything that wants a decision, worst first. Hazardous stock over its ceiling, backorders with no PO behind them, empty shelves, stuck orders, money asleep.
---

1. Run `npm run wholesale -- attention`.
2. The list is already ordered by how much each item can cost. Read it in that order and do not reorder it by ease:
   - **Hazardous stock over its declared ceiling** outranks everything: it is a duty under the hazardous substances regulations, not a preference.
   - **A backorder with no purchase order behind it** means every promise date given for it is fiction. Raise the PO or reset the promise.
   - **Products under the reorder point and overdue POs** are next month's stockouts, visible today.
   - **Late and stuck orders** are the customer call you want to make, not receive.
   - **Unpriced lines, below-cost lines, unbilled shipments, overdue invoices and drafts never sent** are the company's own money, asleep or leaking.
   - **Over-limit exposure** is how a customer's bad year becomes yours.
   - **A regular gone quiet** is usually buying from someone else already.
   - **An adjustment with no reason** is shrinkage nobody can investigate.
3. For each item, say the one action: the command to run, the call to make, or the record to fix. Name who owns it.
4. Anything that needs a letter or an email is drafted, never sent: `npm run docs`, or write to `drafts/`.

If the operator asks "what should I do today", pick the top three and say why those three.
