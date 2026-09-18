<h1 align="center">Wholesale for Claude Code</h1>

<p align="center">
  <strong>The open-source wholesale distribution system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Or installed and run for you.
</p>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-unleashed-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-unleashed">Instead of Unleashed</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, a web front end if you want one, your Unleashed data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/unleashed">How it works</a></td>
  </tr>
</table>

<p align="center">Works with Claude Code, Codex, OpenCode or Cursor (see <a href="AGENTS.md">AGENTS.md</a>).</p>

## What is this

Wholesale for Claude Code does the job you pay Unleashed for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and ask for what you want in plain language. It runs the right query, and it can answer questions the vendor's report menu cannot.

Unleashed charges per user per month, with the B2B portal, advanced inventory and API access sold on top (the pricing page at unleashedsoftware.com spells out the tiers), so a distribution business with a sales team, a warehouse team and an accounts person is paying five figures a year for what is, underneath, a handful of database tables about products, stock and orders.

It is built for a wholesale distributor: the products with their costs, prices and reorder points; the stock in each warehouse as a movement ledger that explains every unit; the customers with their price tiers, agreed prices, credit terms and the paperwork behind them; the sales orders from entry to shipment with backorders recorded honestly; the purchase runs that replenish; and the invoice run that bills what actually shipped, GST on its own line. The words are the words a trade counter and a warehouse already use.

**Nothing sends, pays or talks to an accounting system on its own.** Invoices are drafted here and a person sends them; your accounting system keeps the ledger. The gates are real, though: stock never goes negative, a stopped account refuses new orders, selling below cost demands to be said out loud, an adjustment with no reason refuses to exist, and nothing bills that did not ship.

```
/attention                        everything that wants a decision, worst first
/board                            every open order: late, stuck, unpriced, held
/backorders                       every short quantity, with the inbound PO or its absence
/reorder                          what to buy, from points, live demand and lead times
/stock                            on hand, allocated, available, on order
/ship                             ships what stock allows, backorders the rest honestly
/receive                          receipts update the ledger and the current cost
/bill                             draft invoices for shipped goods, GST on its own line
/margins                          margin per product off stamped prices, losses named
/deadstock                        held 90+ days, no sales: cash on a shelf
/quiet-customers                  regulars who stopped ordering, with who to call
/compliance                       six rules from the Acts, run against your records
/weekly-review                    the Monday review, written from three commands
```

The board, the backorders, the reorder run and the attention list all read the same views over the same ledger, so they can never disagree with each other. Prices are stamped onto each line at entry, off the rule that matched (the customer's price, their tier, the list), so a price change never reprices entered orders and margins never rewrite history.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export request, no API tier, no access ending when a subscription does.
- No per-user fee, no add-on modules, no implementation project. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/wholesale-for-claude-code.git
cd wholesale-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database and loads Kahikatea Trade Supplies, a demo Hamilton distributor with two warehouses, 16 products and its problems showing: 84 drums of class 8 degreaser against a declared ceiling of 60, a 30-bundle backorder with no purchase order behind it, a 24-carton shortfall covered by a PO due in four days, two products under their reorder points, an overdue PO, an order two days past its required date, a line booked at $0 because the product was never priced, 20 kg of coffee on a legacy price below today's cost, $2,044 of shipped goods on no invoice, a $13,800 invoice 30 days overdue, a draft never sent, the biggest account over its limit, a regular quiet for 62 days, four rolls of foil adjusted out with no reason, and $1,664 of bin liners that have not moved in 120 days.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/board`, `/backorders`, `/reorder`, `/stock`, `so SO-5102`, `product CHEM-DEG-20L`. When you are ready for real data, delete `.data/` and start with `/import`, or add records one at a time with `add customer`, `add supplier`, `add product`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so drafts come out in your company's voice, and put your name, colours and GST number in [brand.json](brand.json) so the invoices, picking slips, purchase orders and price lists carry them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. The trade counter, the warehouse and the owner each clone the repo, point at the same `DATABASE_URL`, and work in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: hazardous stock over its ceiling, backorders with no PO, empty shelves, stuck orders, money asleep. |
| `/board` | Every open sales order: late against required dates, part-shipped, flagged for missing or below-cost prices, held on stopped accounts. |
| `/so` | One order's whole story: the lines and how each was priced, what shipped, what is short and why, what is billed, the notes. |
| `/order` | Enter an order. Lines price off the customer's list automatically; stopped accounts and below-cost prices refuse unless overridden out loud. |
| `/ship` | Ship what stock allows, backorder the rest honestly. Stock never goes negative. |
| `/backorders` | Every short quantity with the inbound PO date to promise, or the loud absence of one. |
| `/reorder` | The purchase run: what to buy from reorder points, live demand and supplier lead times, grouped into POs. |
| `/receive` | Receive a PO into the warehouse. Updates the ledger and the product's current cost; refuses over-receipts; ships what it covers. |
| `/stock` | The position per product: on hand, allocated, available, on order. Or one warehouse's shelves. |
| `/product` | One product's card: stock by warehouse, price rules, inbound, the recent ledger. |
| `/deadstock` | Held 90+ days, no sales, nothing allocated, valued at cost. |
| `/margins` | Margin per product, last 28 days, off stamped prices and cost snapshots. Losses are named. |
| `/prices` | What a customer actually pays per product, the price rules, and the products with no price at all. |
| `/bill` | Draft one invoice per customer for everything shipped and unbilled, GST on its own line. Never bills what did not ship. |
| `/debtors` | Who owes what, aged, plus the drafts that never went out. |
| `/customer` | One account's whole relationship: exposure against the limit, terms and PPSR status, orders, invoices, notes. |
| `/quiet-customers` | Active regulars with no order in 45 days, longest quiet first, with the contact to call. |
| `/log` | Conversations and decisions onto the record. The disputes read it later. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Six rules from the Acts, run against your records, each with its source. |
| `/import` | Bring the business across from Unleashed or any system that exports CSV. |
| `/draft-backorder-update` | The customer update a backorder deserves, from the record, into `drafts/`. |
| `/draft-overdue-letter` | The chasing letter, graded to the promises already logged, into `drafts/`. |
| `/customise` | Add a field, rename things, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run wholesale -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # tax invoices, picking slips, purchase orders, customer price lists
npm run view    # the warehouse and the money, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your company's name, logo, colours and GST number are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source, and the CLI enforces the sharpest ones at the gate: `adjust` refuses to write stock off with no reason, `ship` refuses to invent stock, and `order add` refuses a below-cost price that nobody said out loud.

1. Taxable supply information complete behind every invoice (Goods and Services Tax Act 1985, ss 19E to 19K).
2. A PPSR financing statement behind every credit account's retention of title (Personal Property Securities Act 1999).
3. Signed terms of trade behind every credit account (Consumer Guarantees Act 1993 s 43; Fair Trading Act 1986 s 26A).
4. Hazardous stock inside the declared storage ceiling (Health and Safety at Work (Hazardous Substances) Regulations 2017).
5. Nothing shipped at more than the price on the customer's list (Fair Trading Act 1986 s 13(g)).
6. Every stock adjustment explains itself (Companies Act 1993 s 194).

The Australian equivalents (GST Act 1999 tax invoices, PPSA 2009, the Australian Consumer Law, the model WHS hazardous chemicals regulations, Corporations Act s 286) are in the same file, at a high level, with the parts to read. Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your operation.

## Ten questions Unleashed cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which backorders have no purchase order behind them, so every promise date I give today is fiction?
2. What is the real margin on each product after the customer deals, and which legacy price is now below cost because the cost moved and the deal never did?
3. Which customers' orders do we short most often, and is it the same five products every time?
4. How many dollars of stock have not sold in 90 days, and what would writing them off honestly look like on the record?
5. If the Pacific Packaging PO lands four days late, which customers' orders slip with it?
6. What shipped in the last week that still is not invoiced, and how much cash is asleep in that gap?
7. Which credit accounts have no PPSR registration and no signed terms behind them, and what is our exposure on each if one goes under this quarter?
8. Which stock adjustments this month have no reason recorded, and what were they worth at cost?
9. Which regulars have gone quiet in the last 45 days, and what did each of them used to buy every month?
10. Is any hazardous line sitting above the quantity our location certificate actually covers?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your operation.

1. "Load our suppliers, our warehouses, and our products with their costs, sell prices and reorder points."
2. "Import the Unleashed exports in this folder, then tell me what the compliance check finds."
3. "Put our logo, colours and GST number on the invoices, picking slips and price lists."
4. "Our tiers are trade and gold. Load the tier prices from this spreadsheet."
5. "Add a batch number and an expiry date to stock movements, and stop anything expired from shipping."
6. "Walk me through today's reorder run and raise the POs, one per supplier."
7. "Add a rule to `/compliance`: no customer trades past 60 days overdue without a director's sign-off logged."
8. "We are in Australia. Rebuild the compliance file on the GST Act 1999, the PPSA 2009 and the ACL."
9. "Build me a Friday page per rep: their customers' orders, backorders and anyone gone quiet."
10. "Write me a command that drafts the weekly ETA email, one per customer with a backorder."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Unleashed

Export your suppliers, customers, products and stock on hand as CSV, run one command, and the business comes with you. Step by step, with what maps and what deliberately does not: [docs/replace-unleashed.md](docs/replace-unleashed.md).

```bash
npm run wholesale -- import unleashed --suppliers=suppliers.csv --customers=customers.csv --products=products.csv --stock=soh.csv --dry-run
npm run wholesale -- import unleashed --suppliers=suppliers.csv --customers=customers.csv --products=products.csv --stock=soh.csv
```

Cin7 Core, DEAR, Jiwa and any other system that exports CSV go through the same command.

Open orders, customer price deals and sales history deliberately do not import: open orders are re-keyed (half of them turn out to be dead), each price deal is re-entered beside today's cost so the below-cost ones get caught at the door, and stock lands as counted stocktake moves so the ledger starts with an explained truth. The cutover weekend includes a walk around the warehouse, and most operators find at least one surprise, which is the argument for the walk.

## Architecture

```
wholesale-for-claude-code/
  CLAUDE.md                 how the company wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your name, logo, colours and GST number on every document and view
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/wholesale.mjs     the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data (Kahikatea Trade Supplies)
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-unleashed.md moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   letters written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, nothing that sends, and the gates stay gates.

## Want it installed and run for you?

Enterprise DNA installs Wholesale for Claude Code for your company, migrates your Unleashed data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/unleashed

## License

MIT. Copyright (c) 2026 Enterprise DNA.
