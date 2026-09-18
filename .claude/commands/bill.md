---
description: The billing run. Drafts one invoice per customer for everything shipped and not yet invoiced, GST on its own line, due off the account terms. Never bills what did not ship.
---

1. See what is waiting first: `npm run wholesale -- bill --dry-run` (or `bill <customer> --dry-run` for one account). Read the totals back.
2. Run it for real: `bill` or `bill <customer>`. Every draft is goods at the stamped line prices plus GST 15% on its own line.
3. Drafts only, always. The operator checks each one (`invoice <no>`, or `npm run docs -- invoice` for the branded PDF-ready page) and sends from their own system. Then `invoice sent <no>`, and `invoice paid <no>` when the money lands.
4. If the run finds nothing, that is the answer: nothing shipped since the last run. Part-shipments bill for what went; the backordered remainder bills when it ships.
5. What blocks billing is never billed around: an order that has not shipped has nothing to invoice. `board` says why it has not shipped.
