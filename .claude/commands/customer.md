---
description: One account's whole relationship. Exposure against the limit, the compliance paperwork (terms signed, PPSR), orders, invoices, notes and open tasks.
---

1. Run `npm run wholesale -- customer <name>` (partial names resolve; ambiguity lists candidates).
2. The card leads with the money and the paperwork: owing + unbilled = exposure against the limit, terms signed or NEVER, PPSR registered or NOT. Those capitals are deliberate; relay them.
3. Record changes go through `customer set <name>` with the right flag (`--address= --tier= --terms= --limit= --terms-signed= --ppsr= --note=`). Conversations go through `log "..." --customer=`.
4. `stop <name>` and `unstop <name>` are the credit gate: a stopped account refuses new orders at entry. Stopping is the operator's call, always.
5. Before drafting anything customer-facing, read the whole card, including the notes. The last note usually changes the letter.
