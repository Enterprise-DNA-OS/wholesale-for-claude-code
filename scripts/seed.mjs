#!/usr/bin/env node
// Loads supabase/seed.sql: Kahikatea Trade Supplies, a fictional Hamilton
// wholesale distributor with 2 warehouses, 4 suppliers, 16 products, 12
// account customers, 14 sales orders, 3 purchase orders, a stock ledger that
// explains every unit, and six invoices. Every row has a derived id and
// inserts with ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from warehouses)      as warehouses,
           (select count(*) from suppliers)       as suppliers,
           (select count(*) from customers)       as customers,
           (select count(*) from products)        as products,
           (select count(*) from prices)          as prices,
           (select count(*) from sales_orders)    as sales_orders,
           (select count(*) from so_lines)        as so_lines,
           (select count(*) from purchase_orders) as purchase_orders,
           (select count(*) from po_lines)        as po_lines,
           (select count(*) from stock_moves)     as stock_moves,
           (select count(*) from invoices)        as invoices,
           (select count(*) from invoice_lines)   as invoice_lines,
           (select count(*) from notes)           as notes,
           (select count(*) from tasks)           as tasks
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(
      `seed: ${n.warehouses} warehouses, ${n.suppliers} suppliers, ${n.customers} customers, ${n.products} products, ` +
        `${n.prices} price rules, ${n.sales_orders} sales orders (${n.so_lines} lines), ${n.purchase_orders} purchase orders, ` +
        `${n.stock_moves} stock moves, ${n.invoices} invoices (${n.invoice_lines} lines), ${n.notes} notes, ${n.tasks} tasks`,
    );
  } finally {
    await db.close();
  }
}
