---
description: Who owes what, aged, plus the drafts that never went out. The cash position in one table.
---

1. Run `npm run wholesale -- debtors`.
2. Read it oldest first. Say the three numbers that matter: total owing, total overdue, and the biggest single overdue invoice with its customer and days.
3. Drafts marked NOT SENT are self-inflicted: the work was shipped, the invoice exists, nobody sent it. They lead the follow-up list.
4. For anyone over 14 days overdue, offer `/draft-overdue-letter` (drafts to `drafts/`, the operator sends). Check `customer <name>` first: an over-limit account that is also ordering this week is a conversation, not just a letter.
5. `customers` shows the same money as exposure against limits; `stop <name>` is the operator's decision when an account has earned it.
