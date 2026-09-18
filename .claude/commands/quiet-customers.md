---
description: Regulars who stopped ordering. Active accounts with no order in 45 days, longest quiet first, with the contact to call.
---

1. Run `npm run wholesale -- quiet` (tighten or loosen with `--days=`).
2. A quiet regular is usually buying from someone else already. Present the list as calls to make this week, longest quiet first, with the contact name and phone from the output.
3. For each, pull `customer <name>` before the call: what they used to buy and when, any open claim on the relationship in the notes. Sales history beats guesswork.
4. Draft the re-opening note if asked (to `drafts/`, never sent): specific to what they used to order, not a newsletter.
5. Log the outcome of every call: `log "..." --customer=`. Next quarter's quiet list reads today's notes.
