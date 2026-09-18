---
description: Draft the chasing letter for an overdue account, from the record. The invoices, the days, the promises already logged. Drafts to drafts/, never sends.
---

1. Pull the facts: `npm run wholesale -- debtors --json` and `customer <name> --json`. Read the notes: every promise already made and broken changes the letter's temperature.
2. Grade the letter to the record:
   - First nudge (under 14 days): friendly, one invoice, one date, one sentence.
   - Second (14 to 30, or a broken promise logged): firmer, all overdue invoices listed with days, the terms they signed quoted by date.
   - Final (30+, or repeated promises): the position stated plainly, the stop that follows named (`stop <name>` is the operator's call), and the PPSR position if goods are still on their floor.
3. Facts only from the record: invoice numbers, amounts, due dates, the logged promises. No invented sympathy, no legal threats the operator has not authorised.
4. Write it to `drafts/overdue-<customer>.md` with recipient and subject at the top. **Never send anything.**
5. Log it and set the follow-up: `log "Overdue letter drafted" --customer=`, `task add "Chase <name> if unpaid" --due=<+7d>`.
