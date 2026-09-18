---
description: Draft the backorder update a customer deserves, from the record. What is short, what is inbound and when, what has nothing behind it. Drafts to drafts/, never sends.
---

1. Run `npm run wholesale -- backorders --json` and `so <ref> --json` for the order in question, plus `customer <name> --json` for the contact and the relationship.
2. Write the update from the record only:
   - What shipped and when (from the order card).
   - What is short, and the honest date: incoming PO date plus a day for covered lines; for NO PO lines, either the date the operator commits to a PO today, or the truth that there is no date yet.
   - One sentence of what happens next, and who to call.
3. Voice: plain, specific, no apology theatre. "24 cartons of the 8 oz cups follow on Thursday's delivery" beats three sentences of regret.
4. Write it to `drafts/backorder-<so_no>.md` with the recipient and subject at the top. **Never send anything.** The operator reads, edits and sends from their own mail.
5. Log that the update was drafted: `log "Backorder update drafted for <so>" --customer=`.
