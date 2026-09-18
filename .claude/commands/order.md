---
description: Enter a sales order. Creates the order, adds lines priced off the customer's price list (their price, then their tier, then the list), and refuses the traps (stopped accounts, below-cost prices) unless overridden deliberately.
---

The operator will say something like "Matamata wants 20 cartons of 8 oz cups and 10 towels, needed Friday".

1. `npm run wholesale -- order create <customer> [--ref=] [--required=] [--warehouse=]`. A stopped account refuses: that is a conversation with the operator, not a workaround.
2. One `order add <so> <sku> <qty>` per line. Pricing is automatic and stamped; only pass `--price=` when the operator has named a price out loud.
3. Watch the two refusals and relay them honestly:
   - **Below cost** needs `--allow-below-cost`. Ask the operator before adding it; show both numbers.
   - **No price matched** books at $0, loudly. Fix the price (`price set`) or get a price from the operator before the order ships.
4. Read the finished order back with `so <so>`: lines, prices, where each price came from, total value.
5. If stock cannot cover it, say so now (the card shows `Short:` lines) with the incoming PO date from `backorders`, not a guess.
