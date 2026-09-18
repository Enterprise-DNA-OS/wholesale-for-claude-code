---
description: Receive a purchase order into the warehouse. Updates the ledger and the product's current cost, refuses over-receipts, then ships the backorders it covers.
---

1. Run `npm run wholesale -- receive <po>` for the whole delivery, or `receive <po> <sku> <qty>` when only part of it arrived.
2. An over-receipt refuses on purpose: it usually means the supplier sent the wrong thing. Check the paperwork with the operator; if the extra is real, fix the PO line first.
3. Receiving moves the product's current cost to the PO cost, so margins are judged against replacement cost from today.
4. Immediately check `backorders`: what this delivery covers can ship now. Offer to run the `ship <so>` commands, oldest required date first.
5. If the delivery is short or damaged, receive what actually landed and log the rest: `log "..." --so=` or a task to chase the supplier.
