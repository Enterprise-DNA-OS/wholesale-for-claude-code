# Wholesale for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about an account or an order, read its full card first (`customer <name>`, `so <ref>`).
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.
6. **The gates are not obstacles.** A refused ship, a refused below-cost price, a demanded reason: relay the refusal honestly and ask. Never work around a gate.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing today, what is on fire | `/attention` |
| The open orders, what is late or stuck | `/board` |
| One order's story, why it has not shipped | `/so` |
| Enter an order, add lines to one | `/order` |
| Ship an order, ship a backorder | `/ship` |
| What we cannot fill, what to promise | `/backorders` |
| What to buy, raise the purchase run | `/reorder` |
| A delivery arrived | `/receive` |
| What is on the shelf, one warehouse, one product | `/stock`, `/product` |
| Stock that will not sell | `/deadstock` |
| What we make on each product, what loses money | `/margins` |
| What a customer pays, fix a price | `/prices` |
| Invoice what shipped | `/bill` |
| Who owes what | `/debtors` |
| Everything about one account | `/customer` |
| Who stopped ordering | `/quiet-customers` |
| Record a call, a promise, a decision | `/log` |
| The Monday review | `/weekly-review` |
| Are we compliant, the paperwork position | `/compliance` |
| Move off Unleashed, bring data in | `/import` |
| The backorder email, the chasing letter | `/draft-backorder-update`, `/draft-overdue-letter` |
| Change the system itself | `/customise`, `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run wholesale -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed, cancelled (with a reason) or inactive.
- Never invent a record or a number. If a name is ambiguous, list the candidates and ask. If stock is short, say short.
- Stock never goes negative, adjustments always carry a reason, below-cost prices are said out loud, and nothing bills that did not ship. These are the system's promises; keep them.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/wholesale.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json` the company's name, logo, colours and GST number on every document (`npm run docs`) and view (`npm run view`).
- `docs/` the compliance rule book, the Unleashed migration guide, and the honest trade-offs.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/unleashed
