---
description: Every unshipped quantity current stock cannot cover, with the inbound purchase order that will fix it, or the loud absence of one. The promise-date list.
---

1. Run `npm run wholesale -- backorders`.
2. Split the list in two and treat them differently:
   - **Covered** (an `Incoming` date): the promise date is that date plus a day. These need a customer update, not a decision: `/draft-backorder-update`.
   - **NO PO**: every promise made on these is fiction. The decision is `po create` + `po add` today, or telling the customer the truth.
3. Cross-check against `reorder`: a product short here and under its reorder point is one purchase order solving two problems.
4. When stock lands (`receive <po>`), the shorts ship with `ship <so>`, oldest required date first.
