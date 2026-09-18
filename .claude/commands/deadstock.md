---
description: Cash on a shelf. Stock held over 90 days with no sale in 90 days and nothing allocated, valued at cost, worst first.
---

1. Run `npm run wholesale -- deadstock`.
2. State the total plainly: "$X at cost has not moved in over 90 days". That number is the point.
3. For each line, propose one of the standard moves and let the operator pick:
   - Discount it into motion: `price set <sku> --price=` and a note to the customers who buy the category.
   - Return it if the supplier has a buyback: check `supplier <name>` for the relationship, draft the ask to `drafts/`.
   - Write it off honestly: `adjust <sku> -N --reason=...` (the reason is required, and the Companies Act check reads it).
4. Cross-check `reorder` before anything is bought in the same category: dead stock plus a reorder suggestion on the same shelf is a settings problem (`product set --reorder-point=`).
