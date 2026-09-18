---
description: The stock position. On hand, allocated, available and on order per product, or one warehouse's shelves, straight off the movement ledger.
---

1. Run `npm run wholesale -- stock` (or `stock --warehouse=<code>` for one site's shelves).
2. Read the columns properly before answering: **on hand** is what the ledger says is on the shelf, **allocated** is unshipped demand, **available** is the difference, **on order** is inbound. A negative available is a promise the shelf cannot keep.
3. `REORDER` and `OVER` flags in the output are not decoration: point at `reorder` and the hazardous ceiling respectively.
4. For one product's whole story (per warehouse, prices, incoming, recent movements): `product <sku>`. For the audit trail: `moves <sku>`.
5. Fixing a number is never an edit. The shelf's truth goes in through `count <sku> <qty> --warehouse=` (stocktake) or `adjust <sku> <qty> --reason=` (write-off, with the reason it demands).
