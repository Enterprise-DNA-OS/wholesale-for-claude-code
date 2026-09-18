---
description: Every open sales order, in working order. Part-shipped first, then open by required date, with backorder counts, values and the flags (no price, below cost, on stop).
---

1. Run `npm run wholesale -- board`. Add `--customer=<name>` when the ask is about one account, `--all` when history matters.
2. Present it as it comes: part-shipped orders lead because someone is already waiting on the rest.
3. Call out, in one line each: anything late against its required date, anything with a `NO PRICE` or `BELOW COST` flag, and anything on a stopped account.
4. For a specific order, go deeper with `so <ref>`. For what cannot ship, `backorders` names the shortfall and the inbound PO or its absence.
