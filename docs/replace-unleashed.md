# Moving off Unleashed

The whole cutover is four CSV exports and one command. Plan it for a Friday afternoon with a stocktake walk on the weekend; take orders in the new system on Monday.

## 1. Export from Unleashed

From Unleashed's export screens (or a report printed to CSV), pull:

| Export | Where in Unleashed | Feeds |
|---|---|---|
| Suppliers | Suppliers, export | `--suppliers=` |
| Customers | Customers, export (includes sell price tier and payment terms) | `--customers=` |
| Products | Products, export (code, description, group, unit, costs, sell price, min stock alert) | `--products=` |
| Stock on hand | Stock on Hand enquiry or report, exported per warehouse | `--stock=` |

Column names vary by Unleashed version and template; the importer matches the common ones case-insensitively (`Product Code`, `Average Land Price`, `Sell Price Tier 1`, `Min Stock Alert Level`, `On Hand`, `Warehouse Code` and their siblings). If a column is not picked up, rename the header in the CSV; the mapping lives in `scripts/wholesale.mjs` (`cmdImport`) and is meant to be edited.

## 2. Dry-run, then import

```bash
npm run wholesale -- import unleashed --suppliers=suppliers.csv --customers=customers.csv --products=products.csv --stock=soh.csv --dry-run
npm run wholesale -- import unleashed --suppliers=suppliers.csv --customers=customers.csv --products=products.csv --stock=soh.csv
```

The dry run counts what would land and writes nothing. The real run is idempotent: re-running updates rather than duplicates, so a corrected CSV can be imported again without fear.

## 3. What maps

- **Suppliers and customers** with codes, contacts, terms and city. A customer's Unleashed sell price tier becomes their `price_tier` here, so tier pricing keeps working the day you set tier prices (`price set <sku> --tier=`).
- **Products** with SKU, description, group, unit, cost (average landed), base sell price (tier 1), and reorder point and quantity from the stock alert levels.
- **Stock on hand** per warehouse, landing as counted stocktake moves. The ledger's first entry for every product is an explained count, not a mystery balance. Unknown warehouses are created from their code; stock for products you did not import is skipped and named.

## 4. What deliberately does not carry over

- **Open sales and purchase orders.** Re-key what is genuinely still open (`order create`, `po create`) in the first week. Most operations discover that half their "open" Unleashed orders were dead the whole time, which is the point of the exercise.
- **Customer-specific price deals.** Unleashed customer pricing is re-entered with `price set <sku> --price= --customer=` as orders surface, each one looked at beside today's cost. The 2024 deal that is now below cost gets caught at the door instead of imported as a fact.
- **Sales history and margins.** History stays in your Unleashed export archive and your accounting system. Margins here build from the first shipment forward, on stamped prices and cost snapshots you can trust.
- **The paperwork the old system never held.** Signed terms dates, PPSR registrations, hazardous ceilings and customer addresses mostly do not exist in the export. `compliance` will say so on day one, loudly. That list is the first week's admin, and it is work worth doing.

## 5. The cutover weekend

1. Import on Friday after the last order ships.
2. Walk the warehouse with `stock --warehouse=<code>` and `count <sku> <qty>` where the shelf disagrees with the export. Most operations find at least one surprise, which is the argument for the walk.
3. Set the hazardous ceilings your certificates actually cover: `product set <sku> --hazardous --haz-class= --haz-max=`.
4. Put your name, colours and GST number in `brand.json`; fill the "Who this is for" block in `CLAUDE.md`.
5. Monday: `attention`, and take the first order with `order create`.

iCOS, Cin7 Core, DEAR, Jiwa and any other system that exports CSV go through the same command with the same flags: pass `import <source-name>` so the external references record where each row came from.
