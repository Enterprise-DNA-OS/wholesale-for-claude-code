---
description: Bring the business across from Unleashed (or anything that exports CSV). Suppliers, customers with their tiers and terms, products with costs and reorder points, and stock on hand per warehouse.
---

1. Read [docs/replace-unleashed.md](../../docs/replace-unleashed.md) first: it names the exact exports to pull from Unleashed and what deliberately does not carry over.
2. Always dry-run first and read the counts back:
   ```
   npm run wholesale -- import unleashed --suppliers=s.csv --customers=c.csv --products=p.csv --stock=soh.csv --dry-run
   ```
3. Run it for real in the same order the flags imply: suppliers and customers first, then products, then stock (stock lines for unknown products are skipped and named, not guessed).
4. Stock lands as counted stocktake moves, so the ledger starts with an explained truth, not a mystery balance. Re-running the import updates rather than duplicates.
5. After the import, run the honesty checks and report what they say: `stock`, `price check` (imported products with no sell price), `compliance` (terms, PPSR and addresses the old system never held).
6. Open orders and price deals are re-keyed by hand in the first week: `order create` and `price set` as they surface. That is deliberate; the guide says why.
