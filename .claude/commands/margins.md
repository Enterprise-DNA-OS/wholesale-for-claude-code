---
description: Margin per product over the last 28 days of shipments, off the stamped line prices and cost snapshots. Losses are named, not averaged away.
---

1. Run `npm run wholesale -- margins`.
2. Lead with the losses and the thin end: anything marked LOSS, then anything under 20%. Name the products and the dollars.
3. A loss here is a price that needs a decision, not a mystery: `prices <customer>` shows who is on a legacy deal, `product <sku>` shows the cost move that caused it. The fix is `price set` and a conversation the operator has with the customer (draft it to `drafts/`, never send).
4. Margins are stamped at order entry, so this report never rewrites history: fixing a price today changes tomorrow's lines only. Say that when the operator asks why a fixed price still shows a loss.
