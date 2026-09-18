---
description: One product's whole card. Stock by warehouse, allocation, inbound POs, every price rule that touches it, and the recent movement ledger.
---

1. Run `npm run wholesale -- product <sku>` (partial SKUs and names resolve; ambiguity lists candidates).
2. The card answers most questions directly: cost against every price (below-cost rules are flagged on the card), the hazardous ceiling if it has one, who supplies it and their lead time, and what is inbound.
3. Changes go through `product set <sku>` with the right flag (`--cost= --price= --reorder-point= --reorder-qty= --haz-max= --supplier=`), never through invented numbers.
4. For the full audit trail of any unit in or out: `moves <sku> --days=90`.
