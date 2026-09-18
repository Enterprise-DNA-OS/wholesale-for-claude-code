---
description: The Monday review, written from three commands. The compliance position, the shelves, the orders, the money, and the five things that matter this week.
---

Run these three, in this order, and write the review from what they return. Do not write anything they do not support.

```
npm run wholesale -- attention
npm run wholesale -- compliance
npm run wholesale -- stats
```

Then write it in this shape, no more than a page:

1. **The week in one line.** Open orders, units backordered, unbilled dollars, owing and overdue, stock value and the dead share of it, quiet regulars (`stats` has all of it).
2. **The law first, always.** Hazardous stock over any ceiling, missing PPSR registrations, unsigned terms, invoices missing taxable supply information, unexplained adjustments. These lead because they are the lines an auditor or a liquidator reads.
3. **The shelves.** Backorders split into covered and NO PO, the reorder run grouped by supplier, overdue POs with the chase call named.
4. **The orders.** Late against required dates, stuck with nothing shipped, anything flagged NO PRICE or BELOW COST. One line each with the move.
5. **The money.** Shipped-unbilled (run `bill` today if it is real), overdue invoices, drafts never sent, anyone over their limit, and the margin losses from `margins`.
6. **The five things to do this week.** Picked from the attention list, weighted by what breaches first and what it costs, with why each made the list.
7. **One thing to decide.** The single item that needs a person, not a process.

Add `npm run view -- ops` and `npm run view -- money` if the operator wants pages to take to a meeting. They render the same numbers in the company's brand, and they print.

Numbers come from the commands. If a number is not in the output, it does not go in the review.
