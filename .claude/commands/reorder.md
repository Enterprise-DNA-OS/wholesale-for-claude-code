---
description: The purchase run. What to buy today, from reorder points, live demand and supplier lead times together, then raise the POs.
---

1. Run `npm run wholesale -- reorder`. Every row is available + on order at or under the product's reorder point, with a suggested quantity.
2. Group the rows by supplier: one PO per supplier, not one per product.
3. For each supplier: `po create <supplier>` (the expected date defaults to their lead time), then `po add <po> <sku> <qty>` per row. Use the suggested quantity unless the operator says otherwise; say when a suggested buy looks off against `margins` or `deadstock` (do not restock what does not sell).
4. Render what to send: `npm run docs -- purchase-order`. Sending it to the supplier is the operator's, always.
5. Products that keep appearing here have a reorder point set wrong for their real velocity: propose the change (`product set <sku> --reorder-point=`) with the shipment numbers behind it.
