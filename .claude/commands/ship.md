---
description: Ship a sales order. Ships what stock allows from the order's warehouse, records the shortfall as backorder honestly, and never lets stock go negative.
---

1. Run `npm run wholesale -- ship <so>` (`--at=` backdates when the truck already left).
2. Read the result back exactly as it happened: what shipped, what backordered and why. Never soften "18 short" into "mostly done".
3. If it refuses:
   - **On hold**: the hold is a decision. Ask the operator, then `release <so>` and ship.
   - **No stock**: the shelf is empty. `receive` the PO that covers it, or `count` in what the shelf really holds. Do not invent stock.
4. A fully shipped order is billable now: offer `bill <customer>`.
5. Backordered remainders ship by running `ship <so>` again after stock lands. `backorders` is the watchlist.
