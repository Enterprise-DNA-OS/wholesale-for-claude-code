---
description: What a customer actually pays per product (their price, their tier, the list), the price rules, and the products with no price at all.
---

1. For one account: `npm run wholesale -- prices <customer>`. The `Pays` column is the resolved truth, with BELOW COST flagged.
2. For the rulebook itself: `prices` with no argument. For products with no price anywhere: `price check` (their order lines book at $0).
3. Changes are one command each: `price set <sku> --price= --customer=<name>` (an agreed price), `--tier=<tier>` (a tier price), or neither (the list price). Entered orders keep their stamped price; only new lines pick up the change.
4. Before agreeing any new customer price, put it beside the cost from `product <sku>`. Below cost needs the operator to say so out loud.
5. The customer-facing page renders with `npm run docs -- price-list`: one branded price list per account, the same numbers the Fair Trading Act check compares invoices against.
