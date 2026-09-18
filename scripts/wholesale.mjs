#!/usr/bin/env node
// wholesale-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/wholesale.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system records what a wholesale distributor runs on every week: the
// products with their costs, prices and reorder points, the stock in each
// warehouse as a movement ledger that explains every unit, the customers with
// their price tiers and credit, the sales orders from entry to shipment with
// backorders recorded honestly, the purchase orders that replenish, and the
// invoice run that bills what actually shipped. It sends nothing, pays
// nothing and talks to no accounting system on its own: invoices are drafted
// here and a person sends them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, price as priceFmt, isoDate, short, truncate, heading, bar } from './lib/format.mjs';

const GST_PCT = 15; // New Zealand GST, on its own invoice line every time.

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set([
  'json', 'help', 'all', 'dry-run', 'force', 'allow-below-cost', 'hazardous',
]);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates, money, quantities

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand and Australian exports write DD/MM/YYYY, so the first number
  // is the day unless the second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

// "14:05" (today), "2026-09-17 14:05", or a bare date (midnight).
function parseWhen(v, what = 'time') {
  if (!v || v === true) return new Date().toISOString();
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) return `${today()} ${s.padStart(5, '0')}`;
  const dt = s.match(/^(\S+)[ T](\d{1,2}:\d{2})$/);
  if (dt) return `${parseDate(dt[1], what)} ${dt[2].padStart(5, '0')}`;
  return `${parseDate(s, what)} 00:00`;
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '' || v === true) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(n * 100);
}

function parseQty(v, what = 'quantity') {
  if (v === undefined || v === null || v === true) return 0;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new CliError(`"${v}" is not a ${what}.`);
  return n;
}

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact code or sku or name,
// then contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  customer: {
    from: 'customers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.email, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name}${r.on_stop ? ' (ON STOP)' : ''} [${r.price_tier}]`,
    order: 'c.name',
    listing: 'customers',
  },
  supplier: {
    from: 'suppliers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.lead_time_days}d lead)`,
    order: 'c.name',
    listing: 'suppliers',
  },
  product: {
    from: 'products c',
    cols: 'c.*',
    exact: "lower(c.sku) = lower($1)",
    fuzzy: 'c.sku ilike $1 or c.name ilike $1',
    label: (r) => `${r.sku}  ${truncate(r.name, 40)} (${money(r.price_cents)})`,
    order: 'c.sku',
    listing: 'products',
  },
  warehouse: {
    from: 'warehouses c',
    cols: 'c.*',
    exact: 'lower(c.code) = lower($1)',
    fuzzy: 'c.code ilike $1 or c.name ilike $1 or c.city ilike $1',
    label: (r) => `${r.code}  ${r.name || ''}`,
    order: 'c.code',
    listing: 'stock',
  },
  so: {
    from: 'sales_orders c join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name, cu.on_stop, cu.price_tier, cu.terms_days, cu.credit_limit_cents',
    exact: "lower(c.so_no) = lower($1) or lower(coalesce(c.customer_ref, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.so_no ilike $1 or cu.name ilike $1',
    label: (r) => `${r.so_no}  ${r.customer_name} ${isoDate(r.ordered_on)} (${r.status})`,
    order: 'c.ordered_on desc',
    listing: 'board',
  },
  po: {
    from: 'purchase_orders c join suppliers s on s.id = c.supplier_id',
    cols: 'c.*, s.name as supplier_name, s.lead_time_days',
    exact: "lower(c.po_no) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.po_no ilike $1 or s.name ilike $1',
    label: (r) => `${r.po_no}  ${r.supplier_name} ${isoDate(r.ordered_on)} (${r.status})`,
    order: 'c.ordered_on desc',
    listing: 'pos --all',
  },
  invoice: {
    from: 'invoices c join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name',
    exact: 'lower(c.number) = lower($1)',
    fuzzy: 'c.number ilike $1 or cu.name ilike $1',
    label: (r) => `${r.number}  ${r.customer_name} ${money(r.total_cents)} (${r.status})`,
    order: 'c.issued_on desc',
    listing: 'invoices --all',
  },
  task: {
    from: 'tasks c left join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name',
    exact: 'lower(c.title) = lower($1)',
    fuzzy: 'c.title ilike $1 or cu.name ilike $1',
    label: (r) => `${short(r.id)}  ${truncate(r.title, 50)} (${r.status})`,
    order: 'c.due_on',
    listing: 'tasks --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, code or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a code, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

async function nextRef(db, tbl, col, prefix, start) {
  const rows = await db.query(`select ${col} as v from ${tbl} where ${col} like '${prefix}-%'`);
  let max = start;
  for (const r of rows) {
    const n = Number(String(r.v).slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}

async function defaultWarehouse(db) {
  const rows = await db.query('select * from warehouses order by is_default desc, code limit 1');
  if (!rows.length) throw new CliError('No warehouse exists yet. `add warehouse <code>` first.');
  return rows[0];
}

async function onHand(db, productId, warehouseId) {
  const [r] = await db.query(
    'select coalesce(sum(qty), 0) as q from stock_moves where product_id = $1 and warehouse_id = $2',
    [productId, warehouseId],
  );
  return num(r.q);
}

// ---------------------------------------------------------------------------
// Price resolution: the customer's own price, then the customer's tier price,
// then the product's base list price. The winner and its description are
// stamped onto the line at entry and never silently recomputed.

async function resolvePrice(db, productId, customer) {
  const [own] = await db.query('select price_cents from prices where product_id = $1 and customer_id = $2', [productId, customer.id]);
  if (own) return { price_cents: num(own.price_cents), price_desc: 'Customer price' };
  const [tier] = await db.query(
    "select price_cents from prices where product_id = $1 and customer_id is null and lower(coalesce(tier, '')) = lower($2)",
    [productId, customer.price_tier],
  );
  if (tier) return { price_cents: num(tier.price_cents), price_desc: `${customer.price_tier[0].toUpperCase()}${customer.price_tier.slice(1)} tier` };
  const [p] = await db.query('select price_cents from products where id = $1', [productId]);
  if (p && num(p.price_cents) > 0) return { price_cents: num(p.price_cents), price_desc: 'List' };
  return { price_cents: 0, price_desc: null };
}

// ---------------------------------------------------------------------------
// The compliance rule book. Sources and fixes live in docs/compliance.md; the
// SQL here and the words there change together (that is what /customise is for).

const RULES = [
  {
    key: 'taxable-supply',
    title: 'Taxable supply information complete behind every invoice',
    source: 'Goods and Services Tax Act 1985, ss 19E to 19K (taxable supply information, in force since 1 April 2023): supplies over $200 need the supplier\'s name and GST number and the date; supplies over $1,000 also need the recipient\'s name and one identifier such as an address. Your GST number goes in brand.json so the rendered invoice carries it.',
    fix: 'Capture the missing address: `customer set <name> --address="..."`. Then re-run `npm run docs` so the invoice renders complete.',
    sql: `select i.number, cu.name as customer, i.total_cents / 100.0 as total, i.status
          from invoices i
          join customers cu on cu.id = i.customer_id
          where i.status in ('draft', 'sent') and i.total_cents > 100000
            and (cu.address is null or cu.address = '')`,
  },
  {
    key: 'ppsr',
    title: 'A PPSR financing statement behind every credit account',
    source: 'Personal Property Securities Act 1999: a retention of title clause in your terms of trade is a security interest, and it ranks behind everyone who registered unless you perfect it with a financing statement on the PPSR. In a customer liquidation, unregistered means unsecured.',
    fix: 'Register the financing statement on ppsr.companiesoffice.govt.nz, then record it: `customer set <name> --ppsr=<date>`.',
    sql: `select cu.name as customer, cu.credit_limit_cents / 100.0 as credit_limit, cp.exposure_cents / 100.0 as exposure
          from customers cu
          join v_customer_position cp on cp.customer_id = cu.id
          where cu.status = 'active' and cu.credit_limit_cents is not null and cu.ppsr_registered_on is null`,
  },
  {
    key: 'trade-terms',
    title: 'Signed terms of trade behind every credit account',
    source: 'Consumer Guarantees Act 1993 s 43: contracting out in a business-to-business supply is only effective if it is in writing. Fair Trading Act 1986 s 26A: unfair contract terms rules apply to standard-form small trade contracts. Unsigned terms are the version of your terms a court ignores.',
    fix: 'Get the terms returned signed, then record it: `customer set <name> --terms-signed=<date>`. Until then the account trades on the law\'s defaults, not yours.',
    sql: `select cu.name as customer, cu.credit_limit_cents / 100.0 as credit_limit, to_char(cu.created_at, 'YYYY-MM-DD') as customer_since
          from customers cu
          where cu.status = 'active' and cu.credit_limit_cents is not null and cu.terms_signed_on is null`,
  },
  {
    key: 'hazardous',
    title: 'Hazardous stock inside the declared storage ceiling',
    source: 'Health and Safety at Work (Hazardous Substances) Regulations 2017: holding certain hazardous substances above threshold quantities triggers duties (inventory, signage, location compliance certificates). haz_max_qty on the product is the ceiling you have declared safe and certified for; stock above it is a duty you have not met.',
    fix: 'Move stock between sites, return it (`adjust <sku> -N --reason=...`), or get the location certified for more and raise the ceiling (`product set <sku> --haz-max=`). The check is only as good as the ceilings you declare.',
    sql: `select sp.sku, sp.name, sp.haz_class, sp.on_hand, sp.haz_max_qty
          from v_stock_position sp
          where sp.active and sp.hazardous and sp.haz_max_qty is not null and sp.on_hand > sp.haz_max_qty`,
  },
  {
    key: 'pricing',
    title: 'Nothing shipped at more than the price on the list',
    source: 'Fair Trading Act 1986 s 13(g): a false or misleading representation about price is an offence. A customer on an agreed price list who is invoiced above it has been misled about the price, whether the overcharge was a fat finger or not. The check reads the last 28 days of shipments against the price each customer should have been charged.',
    fix: 'If the charge was wrong, credit it in your accounting system and fix the line. If the price list was stale, bring it up to date: `price set <sku> --price= --customer=<name>`.',
    sql: `select so.so_no, cu.name as customer, p.sku, l.qty_shipped, l.price_cents / 100.0 as charged,
                 coalesce(cp.price_cents, tp.price_cents, p.price_cents) / 100.0 as list_price
          from so_lines l
          join sales_orders so on so.id = l.so_id
          join customers cu on cu.id = so.customer_id
          join products p on p.id = l.product_id
          left join prices cp on cp.product_id = l.product_id and cp.customer_id = cu.id
          left join prices tp on tp.product_id = l.product_id and tp.customer_id is null and lower(coalesce(tp.tier, '')) = lower(cu.price_tier)
          where l.qty_shipped > 0 and l.last_shipped_at >= now() - interval '28 days' and so.status <> 'cancelled'
            and l.price_cents > coalesce(cp.price_cents, tp.price_cents, p.price_cents)`,
  },
  {
    key: 'records',
    title: 'Every stock adjustment explains itself',
    source: 'Companies Act 1993 s 194: a company must keep accounting records that correctly record and explain its transactions. An unexplained write-off is exactly what that section, your accountant and any shrinkage investigation all want answered. The check reads the last 30 days of adjustments.',
    fix: 'Backfill the reason: `adjust reason <move-id> "what actually happened"`. Going forward the CLI refuses an adjustment with no reason, so this list only grows from imports and old habits.',
    sql: `select substr(m.id::text, 1, 8) as move_id, p.sku, m.qty, to_char(m.moved_at, 'YYYY-MM-DD') as moved_on
          from stock_moves m
          join products p on p.id = m.product_id
          where m.kind = 'adjustment' and (m.reason is null or m.reason = '')
            and m.moved_at >= now() - interval '30 days'`,
  },
];

// ---------------------------------------------------------------------------
// Reads

const ATTENTION_WORDS = {
  haz_over_threshold: 'HAZARDOUS STOCK OVER THE CEILING',
  backorder_no_po: 'Backordered, NO purchase order',
  reorder_due: 'Under the reorder point',
  po_overdue: 'Purchase order overdue',
  so_late: 'Past the required date',
  so_stuck: 'Entered, nothing shipped',
  price_missing: 'No price: goods leaving for $0',
  below_cost: 'Priced below cost',
  unbilled_shipped: 'Shipped, not billed',
  invoice_overdue: 'Invoice overdue',
  invoice_draft: 'Draft never sent',
  over_credit_limit: 'Over the credit limit',
  customer_quiet: 'Regular gone quiet',
  adjustment_no_reason: 'Adjustment with no reason',
  task_overdue: 'Task overdue',
};
const ATTENTION_ORDER = Object.keys(ATTENTION_WORDS);

async function cmdAttention(db) {
  const rows = await db.query('select * from v_attention');
  rows.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason) || num(b.days) - num(a.days));
  out(rows, () => {
    if (!rows.length) return 'Nothing needs attention. Enjoy it while it lasts.';
    const counts = {};
    for (const r of rows) counts[r.reason] = (counts[r.reason] || 0) + 1;
    const summary = Object.entries(counts).map(([k, v]) => `${ATTENTION_WORDS[k]}: ${v}`).join('  |  ');
    return heading(`Needs attention (${rows.length})`) + `\n  ${summary}\n\n` + table(rows, [
      { key: 'reason', label: 'What', format: (v) => ATTENTION_WORDS[v] || v, width: 34 },
      { key: 'label', label: 'Record', width: 26 },
      { key: 'customer', label: 'Customer', width: 25 },
      { key: 'who', label: 'Who', width: 16 },
      { key: 'days', label: 'Days', align: 'right' },
      { key: 'amount_cents', label: 'Value', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
      { key: 'detail', label: 'Detail', width: 46 },
    ]);
  });
}

async function cmdBoard(db, flags) {
  const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
  const where = [];
  const params = [];
  if (!flags.all) where.push("status in ('open', 'part', 'on-hold')");
  if (cu) { params.push(cu.id); where.push(`customer_id = $${params.length}`); }
  const rows = await db.query(
    `select * from v_order_board ${where.length ? 'where ' + where.join(' and ') : ''}
     order by case status when 'part' then 0 when 'open' then 1 when 'on-hold' then 2 when 'shipped' then 3 else 4 end,
              required_by nulls last, so_no`,
    params,
  );
  out(rows, () => heading(`Sales orders (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'so_no', label: 'Order' },
    { key: 'customer', label: 'Customer', width: 28, format: (v, r) => v + (r.on_stop ? ' [STOP]' : '') },
    { key: 'status', label: 'Status' },
    { key: 'ordered_on', label: 'Ordered', format: isoDate },
    { key: 'required_by', label: 'Required', format: (v, r) => isoDate(v) + (num(r.days_late) > 0 ? ` (${r.days_late}d LATE)` : '') },
    { key: 'lines', label: 'Lines', align: 'right' },
    { key: 'units_unshipped', label: 'Unshipped', align: 'right', format: (v) => (num(v) > 0 ? v : '') },
    { key: 'value_cents', label: 'Value', align: 'right', format: (v) => money(v) },
    { key: 'has_unpriced', label: 'Flags', format: (v, r) => [v ? 'NO PRICE' : '', r.has_below_cost ? 'BELOW COST' : ''].filter(Boolean).join(', ') },
  ]));
}

async function cmdSo(db, ref) {
  const so = await resolve(db, 'so', ref);
  const lines = await db.query(
    `select l.*, p.sku, p.name as product, p.unit,
            (select coalesce(sum(m.qty), 0) from stock_moves m where m.product_id = l.product_id) as on_hand_total
     from so_lines l join products p on p.id = l.product_id where l.so_id = $1 order by l.created_at`,
    [so.id],
  );
  const notes = await db.query('select body, created_at from notes where so_id = $1 order by created_at desc', [so.id]);
  out({ so, lines, notes }, () => {
    const outLines = [heading(`${so.so_no}  ${so.customer_name}${so.on_stop ? ' [ON STOP]' : ''} (${so.status})`)];
    outLines.push(`  Ordered ${isoDate(so.ordered_on)}${so.customer_ref ? ` (their ref ${so.customer_ref})` : ''}, required ${isoDate(so.required_by) || 'open'}.${so.shipped_at ? ` Shipped ${isoDate(so.shipped_at)}.` : ''}`);
    outLines.push(table(lines, [
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product', width: 34 },
      { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'qty_shipped', label: 'Shipped', align: 'right' },
      { key: 'qty_invoiced', label: 'Billed', align: 'right' },
      { key: 'price_cents', label: 'Price', align: 'right', format: (v, r) => (r.price_desc ? priceFmt(v) : 'NO PRICE') },
      { key: 'price_desc', label: 'Priced off', format: (v, r) => (v || 'NOTHING MATCHED') + (num(r.price_cents) < num(r.cost_cents) && v ? ' (BELOW COST)' : '') },
    ]));
    const backordered = lines.filter((l) => num(l.qty) > num(l.qty_shipped));
    if (so.status !== 'shipped' && backordered.length) {
      for (const l of backordered) outLines.push(`  Short: ${l.sku} needs ${num(l.qty) - num(l.qty_shipped)} more (on hand ${l.on_hand_total} total).`);
    }
    const value = lines.reduce((a, l) => a + num(l.qty) * num(l.price_cents), 0);
    outLines.push(`  Value ${money(value)} ex GST.`);
    for (const n of notes) outLines.push(`  Note ${isoDate(n.created_at)}: ${n.body}`);
    return outLines.join('\n');
  });
}

// ---------------------------------------------------------------------------
// Order entry and shipment

async function cmdOrderCreate(db, args, flags) {
  const cu = await resolve(db, 'customer', args.join(' ') || flags.customer);
  if (cu.on_stop) throw new CliError(`${cu.name} is ON STOP${cu.note ? ` (${cu.note})` : ''}. Take the stop off first (\`unstop\`) or sort the account.`);
  if (cu.status !== 'active') throw new CliError(`${cu.name} is marked ${cu.status}.`);
  const wh = flags.warehouse ? await resolve(db, 'warehouse', flags.warehouse) : await defaultWarehouse(db);
  const soNo = await nextRef(db, 'sales_orders', 'so_no', 'SO', 5100);
  const [so] = await db.query(
    `insert into sales_orders (so_no, customer_id, customer_ref, warehouse_id, ordered_on, required_by, note)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [soNo, cu.id, str(flags.ref) || null, wh.id, parseDate(flags.ordered) || today(), parseDate(flags.required), str(flags.note) || null],
  );
  out({ ...so, customer: cu.name }, `Created ${soNo} for ${cu.name} (${wh.code}). Add lines: \`order add ${soNo} <sku> <qty>\`.`);
}

async function cmdOrderAdd(db, args, flags) {
  const so = await resolve(db, 'so', args[0]);
  if (!['open', 'part'].includes(so.status)) throw new CliError(`${so.so_no} is ${so.status}; lines go on open orders.`);
  const p = await resolve(db, 'product', args[1]);
  const qty = parseQty(args[2] ?? flags.qty, 'quantity');
  if (qty <= 0) throw new CliError('Quantity must be positive: `order add <so> <sku> <qty>`.');
  const cu = await resolve(db, 'customer', so.customer_id);
  let priced;
  if (flags.price !== undefined) {
    priced = { price_cents: parseMoney(flags.price), price_desc: 'Manual' };
  } else {
    priced = await resolvePrice(db, p.id, cu);
  }
  if (priced.price_desc && priced.price_cents < num(p.cost_cents) && !flags['allow-below-cost']) {
    throw new CliError(
      `${p.sku} would go on at ${priceFmt(priced.price_cents)} (${priced.price_desc}) against a cost of ${priceFmt(p.cost_cents)}. ` +
      `That is selling below cost. If it is deliberate, say so: --allow-below-cost.`,
    );
  }
  const [line] = await db.query(
    `insert into so_lines (so_id, product_id, qty, price_cents, price_desc, cost_cents)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [so.id, p.id, qty, priced.price_cents, priced.price_desc, num(p.cost_cents)],
  );
  const warn = priced.price_desc ? '' : `  NO PRICE MATCHED: the line is on at $0. Set one (\`price set ${p.sku} --price=\`) and re-add, or price it by hand with --price=.`;
  out({ ...line, sku: p.sku, price_missing: !priced.price_desc }, `${so.so_no}: ${p.sku} x ${qty} at ${priceFmt(priced.price_cents)} (${priced.price_desc || 'NO PRICE'}).${warn}`);
}

async function cmdShip(db, args, flags) {
  const so = await resolve(db, 'so', args[0]);
  if (so.status === 'on-hold') throw new CliError(`${so.so_no} is on hold${so.note ? ` (${so.note})` : ''}. \`release ${so.so_no}\` first: a hold is a decision, not a queue.`);
  if (!['open', 'part'].includes(so.status)) throw new CliError(`${so.so_no} is ${so.status}; nothing to ship.`);
  const wh = so.warehouse_id ? (await db.query('select * from warehouses where id = $1', [so.warehouse_id]))[0] : await defaultWarehouse(db);
  const at = parseWhen(flags.at);
  const lines = await db.query(
    'select l.*, p.sku, p.name as product from so_lines l join products p on p.id = l.product_id where l.so_id = $1 order by l.created_at',
    [so.id],
  );
  const shipped = [];
  const shorted = [];
  for (const l of lines) {
    const remaining = num(l.qty) - num(l.qty_shipped);
    if (remaining <= 0) continue;
    const have = await onHand(db, l.product_id, wh.id);
    const take = Math.min(remaining, Math.max(0, have));
    if (take > 0) {
      await db.query(
        `insert into stock_moves (product_id, warehouse_id, qty, kind, so_line_id, reason, moved_at)
         values ($1, $2, $3, 'shipment', $4, $5, $6)`,
        [l.product_id, wh.id, -take, l.id, so.so_no, at],
      );
      await db.query('update so_lines set qty_shipped = qty_shipped + $2, last_shipped_at = $3 where id = $1', [l.id, take, at]);
      shipped.push({ sku: l.sku, qty: take });
    }
    if (take < remaining) shorted.push({ sku: l.sku, short: remaining - take, on_hand: have });
  }
  if (!shipped.length) {
    throw new CliError(
      `Nothing on ${so.so_no} can ship from ${wh.code}: no stock on hand for what remains.\n` +
      shorted.map((s) => `  ${s.sku}: ${s.short} wanted, ${s.on_hand} on hand`).join('\n') +
      '\nStock never goes negative here. Receive the purchase order first, or `adjust` in what the shelf really holds.',
    );
  }
  const fully = shorted.length === 0;
  await db.query(
    `update sales_orders set status = $2, shipped_at = case when $3 then $4::timestamptz else shipped_at end where id = $1`,
    [so.id, fully ? 'shipped' : 'part', fully, at],
  );
  out({ so_no: so.so_no, status: fully ? 'shipped' : 'part', shipped, backordered: shorted }, () => {
    const l = [`${so.so_no}: shipped ${shipped.map((s) => `${s.sku} x ${s.qty}`).join(', ')} from ${wh.code}.`];
    if (shorted.length) {
      for (const s of shorted) l.push(`  BACKORDER: ${s.sku} ${s.short} short (${s.on_hand} were on hand). It ships when stock lands; \`backorders\` watches it.`);
    } else {
      l.push('  Fully shipped. It is now billable: `bill`.');
    }
    return l.join('\n');
  });
}

async function cmdHold(db, args, flags) {
  const so = await resolve(db, 'so', args[0]);
  if (!['open', 'part'].includes(so.status)) throw new CliError(`${so.so_no} is ${so.status}.`);
  if (!str(flags.reason)) throw new CliError('A hold carries its reason: --reason="..."');
  await db.query("update sales_orders set status = 'on-hold', note = $2 where id = $1", [so.id, str(flags.reason)]);
  out({ so_no: so.so_no, status: 'on-hold' }, `${so.so_no} held: ${flags.reason}`);
}

async function cmdRelease(db, args) {
  const so = await resolve(db, 'so', args[0]);
  if (so.status !== 'on-hold') throw new CliError(`${so.so_no} is not on hold (${so.status}).`);
  const anyShipped = await db.query('select 1 from so_lines where so_id = $1 and qty_shipped > 0 limit 1', [so.id]);
  await db.query('update sales_orders set status = $2 where id = $1', [so.id, anyShipped.length ? 'part' : 'open']);
  out({ so_no: so.so_no, status: anyShipped.length ? 'part' : 'open' }, `${so.so_no} released.`);
}

async function cmdCancel(db, args, flags) {
  const so = await resolve(db, 'so', args[0]);
  if (so.status === 'shipped') throw new CliError(`${so.so_no} already shipped; cancelling now would orphan the stock record.`);
  if (!str(flags.reason)) throw new CliError('Cancelling needs --reason="..." on the record.');
  const anyShipped = await db.query('select 1 from so_lines where so_id = $1 and qty_shipped > 0 limit 1', [so.id]);
  if (anyShipped.length && !flags.force) throw new CliError(`${so.so_no} has shipped quantities. Bill what shipped first, or --force if you know what you are doing.`);
  await db.query("update sales_orders set status = 'cancelled', note = $2 where id = $1", [so.id, str(flags.reason)]);
  out({ so_no: so.so_no, status: 'cancelled' }, `${so.so_no} cancelled: ${flags.reason}`);
}

async function cmdBackorders(db) {
  const rows = await db.query('select * from v_backorders order by required_by nulls last, so_no');
  out(rows, () => heading(`Backorders (${rows.length})`) +
    (rows.length ? '\n  Every unshipped quantity current stock cannot cover, with what is (or is not) inbound.\n' : '') + '\n' +
    table(rows, [
      { key: 'so_no', label: 'Order' },
      { key: 'customer', label: 'Customer', width: 28 },
      { key: 'sku', label: 'SKU' },
      { key: 'qty_short', label: 'Short', align: 'right' },
      { key: 'available', label: 'Avail', align: 'right' },
      { key: 'on_order', label: 'On order', align: 'right' },
      { key: 'next_incoming_on', label: 'Incoming', format: (v) => (v ? isoDate(v) : 'NO PO') },
      { key: 'required_by', label: 'Required', format: isoDate },
      { key: 'value_cents', label: 'Value', align: 'right', format: (v) => money(v) },
    ]));
}

async function cmdReorder(db) {
  const rows = await db.query('select * from v_reorder order by (available + on_order) - reorder_point, sku');
  out(rows, () => heading(`Reorder run (${rows.length})`) +
    (rows.length ? '\n  available + on order at or under the reorder point. Suggested buys, then `po create`.\n' : '') + '\n' +
    table(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Product', width: 32 },
      { key: 'on_hand', label: 'On hand', align: 'right' },
      { key: 'allocated', label: 'Allocated', align: 'right' },
      { key: 'available', label: 'Avail', align: 'right' },
      { key: 'on_order', label: 'On order', align: 'right' },
      { key: 'reorder_point', label: 'Point', align: 'right' },
      { key: 'suggested_qty', label: 'Suggest', align: 'right' },
      { key: 'supplier', label: 'Supplier', width: 26 },
      { key: 'lead_time_days', label: 'Lead', align: 'right', format: (v) => (v ? `${v}d` : '') },
    ]));
}

// ---------------------------------------------------------------------------
// Purchasing

async function cmdPos(db, flags) {
  const rows = await db.query(
    `select po.*, s.name as supplier,
            (select count(*) from po_lines l where l.po_id = po.id) as lines,
            coalesce((select sum(l.qty - l.qty_received) from po_lines l where l.po_id = po.id), 0) as units_open,
            coalesce((select sum(l.qty * l.cost_cents) from po_lines l where l.po_id = po.id), 0) as value_cents,
            case when po.status in ('open', 'part') and po.expected_on < now()::date then (now()::date - po.expected_on) end as days_overdue
     from purchase_orders po join suppliers s on s.id = po.supplier_id
     ${flags.all ? '' : "where po.status in ('open', 'part')"}
     order by po.expected_on nulls last, po.po_no`,
  );
  out(rows, () => heading(`Purchase orders (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'po_no', label: 'PO' },
    { key: 'supplier', label: 'Supplier', width: 30 },
    { key: 'status', label: 'Status' },
    { key: 'ordered_on', label: 'Ordered', format: isoDate },
    { key: 'expected_on', label: 'Expected', format: (v, r) => isoDate(v) + (num(r.days_overdue) > 0 ? ` (${r.days_overdue}d OVERDUE)` : '') },
    { key: 'units_open', label: 'Open units', align: 'right' },
    { key: 'value_cents', label: 'Value', align: 'right', format: (v) => money(v) },
  ]));
}

async function cmdPoCard(db, ref) {
  const po = await resolve(db, 'po', ref);
  const lines = await db.query(
    'select l.*, p.sku, p.name as product from po_lines l join products p on p.id = l.product_id where l.po_id = $1 order by l.created_at',
    [po.id],
  );
  out({ po, lines }, () => {
    const l = [heading(`${po.po_no}  ${po.supplier_name} (${po.status})`)];
    l.push(`  Ordered ${isoDate(po.ordered_on)}, expected ${isoDate(po.expected_on) || 'no date'}.${po.note ? `  ${po.note}` : ''}`);
    l.push(table(lines, [
      { key: 'sku', label: 'SKU' },
      { key: 'product', label: 'Product', width: 34 },
      { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'qty_received', label: 'Received', align: 'right' },
      { key: 'cost_cents', label: 'Cost', align: 'right', format: (v) => priceFmt(v) },
    ]));
    return l.join('\n');
  });
}

async function cmdPoCreate(db, args, flags) {
  const s = await resolve(db, 'supplier', args.join(' ') || flags.supplier);
  const wh = flags.warehouse ? await resolve(db, 'warehouse', flags.warehouse) : await defaultWarehouse(db);
  const poNo = await nextRef(db, 'purchase_orders', 'po_no', 'PO', 7400);
  const expected = parseDate(flags.expected) || addDays(today(), num(s.lead_time_days) || 7);
  const [po] = await db.query(
    'insert into purchase_orders (po_no, supplier_id, warehouse_id, ordered_on, expected_on, note) values ($1, $2, $3, $4, $5, $6) returning *',
    [poNo, s.id, wh.id, parseDate(flags.ordered) || today(), expected, str(flags.note) || null],
  );
  out({ ...po, supplier: s.name }, `Created ${poNo} on ${s.name}, expected ${expected} (their lead time). Add lines: \`po add ${poNo} <sku> <qty>\`.`);
}

async function cmdPoAdd(db, args, flags) {
  const po = await resolve(db, 'po', args[0]);
  if (!['open', 'part'].includes(po.status)) throw new CliError(`${po.po_no} is ${po.status}.`);
  const p = await resolve(db, 'product', args[1]);
  const qty = parseQty(args[2] ?? flags.qty, 'quantity');
  if (qty <= 0) throw new CliError('Quantity must be positive: `po add <po> <sku> <qty>`.');
  const cost = flags.cost !== undefined ? parseMoney(flags.cost) : num(p.cost_cents);
  const [line] = await db.query(
    'insert into po_lines (po_id, product_id, qty, cost_cents) values ($1, $2, $3, $4) returning *',
    [po.id, p.id, qty, cost],
  );
  out({ ...line, sku: p.sku }, `${po.po_no}: ${p.sku} x ${qty} at ${priceFmt(cost)}.`);
}

async function cmdReceive(db, args, flags) {
  const po = await resolve(db, 'po', args[0]);
  if (!['open', 'part'].includes(po.status)) throw new CliError(`${po.po_no} is ${po.status}; nothing to receive.`);
  const wh = po.warehouse_id ? (await db.query('select * from warehouses where id = $1', [po.warehouse_id]))[0] : await defaultWarehouse(db);
  const at = parseWhen(flags.at);
  const onlyProduct = args[1] ? await resolve(db, 'product', args[1]) : null;
  const qtyArg = args[2] !== undefined ? parseQty(args[2], 'quantity') : null;
  const lines = await db.query(
    'select l.*, p.sku from po_lines l join products p on p.id = l.product_id where l.po_id = $1 order by l.created_at',
    [po.id],
  );
  const received = [];
  for (const l of lines) {
    if (onlyProduct && l.product_id !== onlyProduct.id) continue;
    const outstanding = num(l.qty) - num(l.qty_received);
    if (outstanding <= 0) continue;
    const take = qtyArg !== null && onlyProduct ? qtyArg : outstanding;
    if (take > outstanding) {
      throw new CliError(`${l.sku}: receiving ${take} against ${outstanding} outstanding on ${po.po_no}. Over-receipts hide supplier errors; fix the PO line first (\`po add\`) if the extra is real.`);
    }
    await db.query(
      `insert into stock_moves (product_id, warehouse_id, qty, kind, po_line_id, reason, moved_at)
       values ($1, $2, $3, 'receipt', $4, $5, $6)`,
      [l.product_id, wh.id, take, l.id, `${po.po_no} received`, at],
    );
    await db.query('update po_lines set qty_received = qty_received + $2 where id = $1', [l.id, take]);
    // The buy cost on the PO becomes the product's current cost: the next
    // order line's margin is judged against what replacement actually costs.
    if (num(l.cost_cents) > 0) await db.query('update products set cost_cents = $2 where id = $1', [l.product_id, num(l.cost_cents)]);
    received.push({ sku: l.sku, qty: take });
  }
  if (!received.length) throw new CliError(`Nothing outstanding${onlyProduct ? ` for ${onlyProduct.sku}` : ''} on ${po.po_no}.`);
  const [{ open_left }] = await db.query('select coalesce(sum(qty - qty_received), 0) as open_left from po_lines where po_id = $1', [po.id]);
  const fully = num(open_left) <= 0;
  await db.query('update purchase_orders set status = $2 where id = $1', [po.id, fully ? 'received' : 'part']);
  out({ po_no: po.po_no, status: fully ? 'received' : 'part', received }, () =>
    `${po.po_no}: received ${received.map((r) => `${r.sku} x ${r.qty}`).join(', ')} into ${wh.code}.` +
    (fully ? ' Fully received.' : ` ${open_left} units still to come.`) +
    ' Backorders it covers can ship now: `backorders`, then `ship <so>`.');
}

// ---------------------------------------------------------------------------
// Stock

async function cmdStock(db, flags) {
  if (flags.warehouse) {
    const wh = await resolve(db, 'warehouse', flags.warehouse);
    const rows = await db.query(
      'select * from v_stock where warehouse_id = $1 and (on_hand <> 0 or $2) order by sku',
      [wh.id, Boolean(flags.all)],
    );
    out(rows, () => heading(`Stock in ${wh.code}`) + '\n' + table(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Product', width: 36 },
      { key: 'unit', label: 'Unit' },
      { key: 'on_hand', label: 'On hand', align: 'right' },
    ]));
    return;
  }
  const rows = await db.query(
    `select * from v_stock_position where active ${flags.all ? '' : 'and (on_hand <> 0 or allocated <> 0 or on_order <> 0)'} order by sku`,
  );
  out(rows, () => heading(`Stock position (${rows.length} products)`) + '\n' + table(rows, [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product', width: 32 },
    { key: 'on_hand', label: 'On hand', align: 'right' },
    { key: 'allocated', label: 'Allocated', align: 'right' },
    { key: 'available', label: 'Avail', align: 'right', format: (v) => (num(v) < 0 ? `${v} SHORT` : v) },
    { key: 'on_order', label: 'On order', align: 'right' },
    { key: 'reorder_point', label: 'Point', align: 'right', format: (v, r) => v + (num(r.available) + num(r.on_order) <= num(v) && num(v) > 0 ? ' REORDER' : '') },
    { key: 'hazardous', label: 'Haz', format: (v, r) => (v ? `class ${r.haz_class}${num(r.on_hand) > num(r.haz_max_qty) ? ' OVER' : ''}` : '') },
  ]));
}

async function cmdProduct(db, args, flags) {
  const sub = args[0];
  if (sub === 'set') return cmdProductSet(db, args.slice(1), flags);
  const p = await resolve(db, 'product', args.join(' '));
  const [pos] = await db.query('select * from v_stock_position where id = $1', [p.id]);
  const byWh = await db.query('select * from v_stock where product_id = $1 and on_hand <> 0 order by warehouse', [p.id]);
  const prices = await db.query(
    `select pr.*, cu.name as customer_name from prices pr left join customers cu on cu.id = pr.customer_id
     where pr.product_id = $1 order by pr.customer_id nulls first, pr.tier`,
    [p.id],
  );
  const moves = await db.query(
    `select m.*, w.code as warehouse from stock_moves m join warehouses w on w.id = m.warehouse_id
     where m.product_id = $1 order by m.moved_at desc limit 8`,
    [p.id],
  );
  out({ product: p, position: pos, by_warehouse: byWh, prices, recent_moves: moves }, () => {
    const l = [heading(`${p.sku}  ${p.name}${p.active ? '' : ' (inactive)'}`)];
    l.push(`  ${p.category || 'uncategorised'}, per ${p.unit}${p.pack_size ? ` of ${p.pack_size}` : ''}. Cost ${priceFmt(p.cost_cents)}, list ${num(p.price_cents) > 0 ? priceFmt(p.price_cents) : 'NEVER PRICED'}.`);
    if (p.hazardous) l.push(`  HAZARDOUS class ${p.haz_class || '?'}: ceiling ${p.haz_max_qty ?? 'not declared'} ${p.unit}, on hand ${pos.on_hand}${num(pos.on_hand) > num(p.haz_max_qty) ? ' (OVER)' : ''}.`);
    l.push(`  On hand ${pos.on_hand} (${byWh.map((w) => `${w.warehouse} ${w.on_hand}`).join(', ') || 'nowhere'}), allocated ${pos.allocated}, available ${pos.available}, on order ${pos.on_order}${pos.next_incoming_on ? ` (lands ${isoDate(pos.next_incoming_on)})` : ''}.`);
    l.push(`  Reorder at ${p.reorder_point}, buy ${p.reorder_qty} from ${pos.supplier || 'no supplier'}${pos.lead_time_days ? ` (${pos.lead_time_days}d lead)` : ''}.`);
    for (const pr of prices) l.push(`  Price: ${pr.customer_name ? pr.customer_name : `${pr.tier} tier`} ${priceFmt(pr.price_cents)}${num(pr.price_cents) < num(p.cost_cents) ? ' (BELOW COST)' : ''}`);
    if (moves.length) {
      l.push('  Recent movements:');
      for (const m of moves) l.push(`    ${isoDate(m.moved_at)}  ${m.warehouse}  ${num(m.qty) > 0 ? '+' : ''}${m.qty}  ${m.kind}${m.reason ? `  ${truncate(m.reason, 40)}` : ''}`);
    }
    return l.join('\n');
  });
}

async function cmdProductSet(db, args, flags) {
  const p = await resolve(db, 'product', args.join(' '));
  const sets = [];
  const vals = [p.id];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (flags.cost !== undefined) add('cost_cents', parseMoney(flags.cost));
  if (flags.price !== undefined) add('price_cents', parseMoney(flags.price));
  if (flags['reorder-point'] !== undefined) add('reorder_point', parseQty(flags['reorder-point']));
  if (flags['reorder-qty'] !== undefined) add('reorder_qty', parseQty(flags['reorder-qty']));
  if (flags['haz-max'] !== undefined) add('haz_max_qty', parseQty(flags['haz-max']));
  if (flags['haz-class'] !== undefined) add('haz_class', str(flags['haz-class']) || null);
  if (flags.hazardous !== undefined) add('hazardous', Boolean(flags.hazardous));
  if (flags.supplier !== undefined) add('supplier_id', (await resolve(db, 'supplier', flags.supplier)).id);
  if (flags.name !== undefined) add('name', str(flags.name));
  if (!sets.length) throw new CliError('product set <sku> takes --cost= --price= --reorder-point= --reorder-qty= --haz-max= --haz-class= --hazardous --supplier= --name=');
  const [row] = await db.query(`update products set ${sets.join(', ')} where id = $1 returning *`, vals);
  out(row, `${p.sku} updated.`);
}

async function cmdMoves(db, args, flags) {
  const p = await resolve(db, 'product', args.join(' '));
  const days = num(flags.days) || 60;
  const rows = await db.query(
    `select m.*, w.code as warehouse, so.so_no, po.po_no
     from stock_moves m
     join warehouses w on w.id = m.warehouse_id
     left join so_lines sl on sl.id = m.so_line_id left join sales_orders so on so.id = sl.so_id
     left join po_lines pl on pl.id = m.po_line_id left join purchase_orders po on po.id = pl.po_id
     where m.product_id = $1 and m.moved_at >= now() - ($2::text || ' days')::interval
     order by m.moved_at desc`,
    [p.id, String(days)],
  );
  out(rows, () => heading(`${p.sku}: movements, last ${days} days (${rows.length})`) + '\n' + table(rows, [
    { key: 'moved_at', label: 'When', format: isoDate },
    { key: 'warehouse', label: 'WH' },
    { key: 'qty', label: 'Qty', align: 'right', format: (v) => (num(v) > 0 ? `+${v}` : v) },
    { key: 'kind', label: 'Kind' },
    { key: 'so_no', label: 'Order', format: (v, r) => v || r.po_no || '' },
    { key: 'reason', label: 'Reason', width: 40, format: (v, r) => v || (r.kind === 'adjustment' ? 'NO REASON' : '') },
    { key: 'id', label: 'Move', format: short },
  ]));
}

async function cmdAdjust(db, args, flags) {
  if (args[0] === 'reason') {
    const idPrefix = str(args[1]);
    const reason = args.slice(2).join(' ') || str(flags.reason);
    if (!idPrefix || !reason) throw new CliError('adjust reason <move-id> "what actually happened"');
    const rows = await db.query("select m.*, p.sku from stock_moves m join products p on p.id = m.product_id where m.kind = 'adjustment' and m.id::text like $1", [idPrefix.toLowerCase() + '%']);
    if (!rows.length) throw new CliError(`No adjustment matches move id "${idPrefix}".`);
    if (rows.length > 1) throw new CliError(`"${idPrefix}" matches ${rows.length} adjustments; use more characters.`);
    await db.query('update stock_moves set reason = $2 where id = $1', [rows[0].id, reason]);
    out({ id: rows[0].id, reason }, `${rows[0].sku} adjustment ${short(rows[0].id)} now explains itself: ${reason}`);
    return;
  }
  const p = await resolve(db, 'product', args[0]);
  const qty = parseQty(args[1], 'adjustment');
  if (!qty) throw new CliError('adjust <sku> <qty> --reason="..." (negative writes stock off, positive writes it on)');
  const reason = str(flags.reason);
  if (!reason) {
    throw new CliError(
      'An adjustment with no reason is a record that explains nothing (Companies Act 1993 s 194 wants better, and so does your accountant). --reason="what actually happened".',
    );
  }
  const wh = flags.warehouse ? await resolve(db, 'warehouse', flags.warehouse) : await defaultWarehouse(db);
  const have = await onHand(db, p.id, wh.id);
  if (have + qty < 0) throw new CliError(`${p.sku} has ${have} on hand in ${wh.code}; adjusting by ${qty} would go negative. Count what is really there: \`count ${p.sku} <qty> --warehouse=${wh.code}\`.`);
  const [m] = await db.query(
    "insert into stock_moves (product_id, warehouse_id, qty, kind, reason, moved_at) values ($1, $2, $3, 'adjustment', $4, $5) returning *",
    [p.id, wh.id, qty, reason, parseWhen(flags.at)],
  );
  out({ ...m, sku: p.sku, on_hand: have + qty }, `${p.sku} ${qty > 0 ? '+' : ''}${qty} in ${wh.code} (${reason}). On hand there: ${have + qty}.`);
}

async function cmdCount(db, args, flags) {
  const p = await resolve(db, 'product', args[0]);
  const counted = parseQty(args[1], 'count');
  if (counted < 0) throw new CliError('A count cannot be negative. Count what is on the shelf.');
  const wh = flags.warehouse ? await resolve(db, 'warehouse', flags.warehouse) : await defaultWarehouse(db);
  const have = await onHand(db, p.id, wh.id);
  const delta = counted - have;
  if (delta === 0) {
    out({ sku: p.sku, warehouse: wh.code, on_hand: have, delta: 0 }, `${p.sku} in ${wh.code}: the book already says ${have}. Nothing to write.`);
    return;
  }
  const [m] = await db.query(
    "insert into stock_moves (product_id, warehouse_id, qty, kind, reason, moved_at) values ($1, $2, $3, 'count', $4, $5) returning *",
    [p.id, wh.id, delta, `Stocktake: counted ${counted}, book said ${have}${flags.reason ? `. ${flags.reason}` : ''}`, parseWhen(flags.at)],
  );
  out({ ...m, sku: p.sku, on_hand: counted, delta }, `${p.sku} in ${wh.code}: counted ${counted}, book said ${have}. Wrote ${delta > 0 ? '+' : ''}${delta}.`);
}

async function cmdDeadstock(db) {
  const rows = await db.query('select * from v_dead_stock order by value_cents desc');
  const total = rows.reduce((a, r) => a + num(r.value_cents), 0);
  out(rows, () => heading(`Dead stock (${rows.length}, ${money(total)} at cost)`) +
    (rows.length ? '\n  Held over 90 days, no sale in 90 days, nothing allocated. Cash on a shelf.\n' : '') + '\n' +
    table(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Product', width: 36 },
      { key: 'on_hand', label: 'On hand', align: 'right' },
      { key: 'value_cents', label: 'Value at cost', align: 'right', format: (v) => money(v) },
      { key: 'days_held', label: 'Held', align: 'right', format: (v) => `${v}d` },
      { key: 'last_shipped_at', label: 'Last sold', format: (v) => (v ? isoDate(v) : 'never') },
    ]));
}

// ---------------------------------------------------------------------------
// Prices

async function cmdPrices(db, args) {
  const q = args.join(' ');
  if (q) {
    const cu = await resolve(db, 'customer', q);
    const rows = await db.query(
      `select p.sku, p.name, p.cost_cents, p.price_cents as list_cents,
              cp.price_cents as customer_cents, tp.price_cents as tier_cents
       from products p
       left join prices cp on cp.product_id = p.id and cp.customer_id = $1
       left join prices tp on tp.product_id = p.id and tp.customer_id is null and lower(coalesce(tp.tier, '')) = lower($2)
       where p.active order by p.sku`,
      [cu.id, cu.price_tier],
    );
    out(rows.map((r) => ({ ...r, effective_cents: r.customer_cents ?? r.tier_cents ?? (num(r.list_cents) > 0 ? r.list_cents : null) })), () =>
      heading(`Prices for ${cu.name} (${cu.price_tier} tier)`) + '\n' + table(rows, [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Product', width: 34 },
        { key: 'cost_cents', label: 'Cost', align: 'right', format: (v) => priceFmt(v) },
        { key: 'list_cents', label: 'List', align: 'right', format: (v) => (num(v) > 0 ? priceFmt(v) : 'NO PRICE') },
        { key: 'tier_cents', label: 'Tier', align: 'right', format: (v) => (v === null ? '' : priceFmt(v)) },
        { key: 'customer_cents', label: 'Theirs', align: 'right', format: (v) => (v === null ? '' : priceFmt(v)) },
        { key: 'sku', label: 'Pays', align: 'right', format: (_, r) => {
          const eff = r.customer_cents ?? r.tier_cents ?? (num(r.list_cents) > 0 ? r.list_cents : null);
          return eff === null ? 'NO PRICE' : priceFmt(eff) + (num(eff) < num(r.cost_cents) ? ' BELOW COST' : '');
        } },
      ]));
    return;
  }
  const rows = await db.query(
    `select pr.*, p.sku, p.cost_cents, cu.name as customer_name
     from prices pr join products p on p.id = pr.product_id left join customers cu on cu.id = pr.customer_id
     order by p.sku, pr.customer_id nulls first`,
  );
  out(rows, () => heading(`Price rules (${rows.length})`) + '\n' + table(rows, [
    { key: 'sku', label: 'SKU' },
    { key: 'tier', label: 'Applies to', format: (v, r) => r.customer_name || `${v} tier` },
    { key: 'price_cents', label: 'Price', align: 'right', format: (v) => priceFmt(v) },
    { key: 'cost_cents', label: 'Cost', align: 'right', format: (v) => priceFmt(v) },
    { key: 'price_cents', label: '', format: (v, r) => (num(v) < num(r.cost_cents) ? 'BELOW COST' : '') },
    { key: 'effective_on', label: 'Since', format: isoDate },
    { key: 'note', label: 'Note', width: 36 },
  ]));
}

async function cmdPriceSet(db, args, flags) {
  const p = await resolve(db, 'product', args[0]);
  const cents = parseMoney(flags.price ?? args[1]);
  if (cents <= 0) throw new CliError('price set <sku> --price=<amount> [--customer=<name> | --tier=<tier>]');
  if (flags.customer) {
    const cu = await resolve(db, 'customer', flags.customer);
    const existing = await db.query('select id from prices where product_id = $1 and customer_id = $2', [p.id, cu.id]);
    if (existing.length) await db.query('update prices set price_cents = $2, effective_on = now()::date where id = $1', [existing[0].id, cents]);
    else await db.query('insert into prices (product_id, customer_id, price_cents) values ($1, $2, $3)', [p.id, cu.id, cents]);
    out({ sku: p.sku, customer: cu.name, price_cents: cents }, `${p.sku} for ${cu.name}: ${priceFmt(cents)}${cents < num(p.cost_cents) ? ' (BELOW COST, deliberately?)' : ''}. Open orders keep their entered price; new lines pick this up.`);
    return;
  }
  if (flags.tier) {
    const tier = str(flags.tier).toLowerCase();
    const existing = await db.query("select id from prices where product_id = $1 and customer_id is null and lower(coalesce(tier, '')) = $2", [p.id, tier]);
    if (existing.length) await db.query('update prices set price_cents = $2, effective_on = now()::date where id = $1', [existing[0].id, cents]);
    else await db.query('insert into prices (product_id, tier, price_cents) values ($1, $2, $3)', [p.id, tier, cents]);
    out({ sku: p.sku, tier, price_cents: cents }, `${p.sku} ${tier} tier: ${priceFmt(cents)}.`);
    return;
  }
  await db.query('update products set price_cents = $2 where id = $1', [p.id, cents]);
  out({ sku: p.sku, price_cents: cents }, `${p.sku} list price: ${priceFmt(cents)}.`);
}

async function cmdPriceCheck(db) {
  const rows = await db.query(
    `select p.sku, p.name, p.cost_cents,
            (select count(*) from so_lines l join sales_orders so on so.id = l.so_id
             where l.product_id = p.id and l.price_desc is null and so.status in ('open', 'part', 'on-hold')) as unpriced_lines
     from products p where p.active and p.price_cents = 0
       and not exists (select 1 from prices pr where pr.product_id = p.id)
     order by p.sku`,
  );
  out(rows, () => heading(`Unpriced products (${rows.length})`) +
    (rows.length ? '\n  No list, no tier, no customer price. Any order line books at $0.\n' : '') + '\n' +
    table(rows, [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Product', width: 40 },
      { key: 'cost_cents', label: 'Cost', align: 'right', format: (v) => priceFmt(v) },
      { key: 'unpriced_lines', label: '$0 lines open', align: 'right' },
    ]));
}

// ---------------------------------------------------------------------------
// Billing

async function cmdBill(db, args, flags) {
  const cu = args.length ? await resolve(db, 'customer', args.join(' ')) : null;
  const rows = await db.query(
    `select * from v_unbilled ${cu ? 'where customer_id = $1' : ''} order by customer, so_no`,
    cu ? [cu.id] : [],
  );
  if (!rows.length) throw new CliError(`Nothing billable${cu ? ` for ${cu.name}` : ''}: nothing shipped and uninvoiced.`);
  const byCustomer = new Map();
  for (const r of rows) {
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
    byCustomer.get(r.customer_id).push(r);
  }
  const dry = Boolean(flags['dry-run']);
  const invoices = [];
  for (const [customerId, lines] of byCustomer) {
    const [customer] = await db.query('select * from customers where id = $1', [customerId]);
    const goods = lines.reduce((a, l) => a + num(l.value_cents), 0);
    const gst = Math.round(goods * GST_PCT / 100);
    const total = goods + gst;
    const number = dry ? '(dry run)' : await nextRef(db, 'invoices', 'number', 'INV', 3100);
    if (!dry) {
      const dueOn = addDays(today(), num(customer.terms_days) || 20);
      const [inv] = await db.query(
        'insert into invoices (number, customer_id, issued_on, due_on, status, total_cents) values ($1, $2, $3, $4, $5, $6) returning id',
        [number, customerId, today(), dueOn, 'draft', total],
      );
      for (const l of lines) {
        await db.query(
          'insert into invoice_lines (invoice_id, so_line_id, description, qty, amount_cents) values ($1, $2, $3, $4, $5)',
          [inv.id, l.so_line_id, `${l.sku} x ${l.qty_unbilled} on ${l.so_no}`, l.qty_unbilled, num(l.value_cents)],
        );
        await db.query('update so_lines set qty_invoiced = qty_invoiced + $2 where id = $1', [l.so_line_id, num(l.qty_unbilled)]);
      }
      await db.query(`insert into invoice_lines (invoice_id, description, amount_cents) values ($1, 'GST ${GST_PCT}%', $2)`, [inv.id, gst]);
    }
    invoices.push({ number, customer: customer.name, lines: lines.length, goods_cents: goods, gst_cents: gst, total_cents: total });
  }
  out({ dry_run: dry, invoices }, () => {
    const l = [heading(dry ? 'Billing dry run (nothing written)' : 'Invoices drafted')];
    for (const i of invoices) l.push(`  ${i.number}  ${i.customer}: ${i.lines} line${i.lines === 1 ? '' : 's'}, goods ${money(i.goods_cents)} + GST ${money(i.gst_cents)} = ${money(i.total_cents)}`);
    if (!dry) l.push('  Drafts only. Check each (`invoice <no>`, `npm run docs`), send from your own system, then `invoice sent <no>`.');
    return l.join('\n');
  });
}

async function cmdInvoices(db, flags) {
  const rows = await db.query(
    `select i.*, cu.name as customer from invoices i join customers cu on cu.id = i.customer_id
     ${flags.all ? '' : "where i.status <> 'paid'"} order by i.issued_on desc`,
  );
  out(rows, () => heading(`Invoices (${rows.length}${flags.all ? '' : ' not yet paid'})`) + '\n' + table(rows, [
    { key: 'number', label: 'Invoice' },
    { key: 'customer', label: 'Customer', width: 30 },
    { key: 'issued_on', label: 'Issued', format: isoDate },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'status', label: 'Status' },
    { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
  ]));
}

async function cmdInvoice(db, args, flags) {
  const sub = args[0];
  if (sub === 'sent' || sub === 'paid') {
    const inv = await resolve(db, 'invoice', args[1]);
    if (sub === 'sent' && inv.status !== 'draft') throw new CliError(`${inv.number} is already ${inv.status}.`);
    if (sub === 'paid' && inv.status !== 'sent') throw new CliError(`Only a sent invoice gets paid. ${inv.number} is ${inv.status}.`);
    await db.query('update invoices set status = $2 where id = $1', [inv.id, sub]);
    out({ number: inv.number, status: sub }, `${inv.number} marked ${sub}.`);
    return;
  }
  const inv = await resolve(db, 'invoice', args[0]);
  const lines = await db.query('select * from invoice_lines where invoice_id = $1 order by created_at', [inv.id]);
  out({ invoice: inv, lines }, () => {
    const l = [heading(`${inv.number}  ${inv.customer_name} (${inv.status})`)];
    l.push(`  Issued ${isoDate(inv.issued_on)}, due ${isoDate(inv.due_on)}. Total ${money(inv.total_cents)} incl GST.`);
    l.push(table(lines, [
      { key: 'description', label: 'Line', width: 52 },
      { key: 'qty', label: 'Qty', align: 'right', format: (v) => (v === null ? '' : v) },
      { key: 'amount_cents', label: 'Amount', align: 'right', format: (v) => priceFmt(v) },
    ]));
    return l.join('\n');
  });
}

async function cmdDebtors(db) {
  const rows = await db.query('select * from v_debtors order by days_overdue desc nulls last, due_on');
  out(rows, () => heading(`Debtors (${rows.length})`) + '\n' + table(rows, [
    { key: 'number', label: 'Invoice' },
    { key: 'customer', label: 'Customer', width: 30 },
    { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
    { key: 'status', label: 'Status', format: (v) => (v === 'draft' ? 'draft NOT SENT' : v) },
    { key: 'due_on', label: 'Due', format: isoDate },
    { key: 'bucket', label: 'Aged' },
    { key: 'days_overdue', label: 'Overdue', align: 'right', format: (v) => (v ? `${v}d` : '') },
  ]));
}

async function cmdMargins(db, flags) {
  const rows = await db.query('select * from v_margins order by margin_cents');
  out(rows, () => heading('Margins, last 28 days of shipments') + '\n' + table(rows, [
    { key: 'sku', label: 'SKU' },
    { key: 'product', label: 'Product', width: 32 },
    { key: 'units_shipped', label: 'Units', align: 'right' },
    { key: 'revenue_cents', label: 'Revenue', align: 'right', format: (v) => money(v) },
    { key: 'cost_cents', label: 'Cost', align: 'right', format: (v) => money(v) },
    { key: 'margin_cents', label: 'Margin', align: 'right', format: (v) => (num(v) < 0 ? `${money(v)} LOSS` : money(v)) },
    { key: 'margin_pct', label: '%', align: 'right', format: (v) => (v === null ? '' : `${v}%`) },
    { key: 'margin_pct', label: '', format: (v) => bar(Math.max(0, num(v)) * 2) },
  ]) + '\n\n  Off the stamped line prices and cost snapshots, so a price change never rewrites history.');
}

// ---------------------------------------------------------------------------
// Customers and suppliers

async function cmdCustomers(db) {
  const rows = await db.query("select * from v_customer_position where status = 'active' order by exposure_cents desc, customer");
  out(rows, () => heading(`Customers (${rows.length})`) + '\n' + table(rows, [
    { key: 'customer', label: 'Customer', width: 32, format: (v, r) => v + (r.on_stop ? ' [STOP]' : '') },
    { key: 'price_tier', label: 'Tier' },
    { key: 'open_orders', label: 'Open', align: 'right' },
    { key: 'owing_cents', label: 'Owing', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
    { key: 'unbilled_cents', label: 'Unbilled', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
    { key: 'exposure_cents', label: 'Exposure', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
    { key: 'credit_limit_cents', label: 'Limit', align: 'right', format: (v, r) => (v === null ? 'cash' : money(v) + (num(r.exposure_cents) > num(v) ? ' OVER' : '')) },
    { key: 'quiet_days', label: 'Last order', align: 'right', format: (v, r) => (r.last_order_on ? `${v}d ago` : 'never') },
  ]));
}

async function cmdCustomer(db, args, flags) {
  if (args[0] === 'set') return cmdCustomerSet(db, args.slice(1), flags);
  const cu = await resolve(db, 'customer', args.join(' '));
  const [pos] = await db.query('select * from v_customer_position where customer_id = $1', [cu.id]);
  const orders = await db.query('select * from v_order_board where customer_id = $1 order by ordered_on desc limit 8', [cu.id]);
  const invoices = await db.query('select * from invoices where customer_id = $1 order by issued_on desc limit 6', [cu.id]);
  const notes = await db.query('select body, created_at from notes where customer_id = $1 order by created_at desc limit 6', [cu.id]);
  const tasks = await db.query("select * from tasks where customer_id = $1 and status = 'open' order by due_on", [cu.id]);
  out({ customer: cu, position: pos, orders, invoices, notes, tasks }, () => {
    const l = [heading(`${cu.name}${cu.on_stop ? ' [ON STOP]' : ''} (${cu.price_tier} tier)`)];
    l.push(`  ${cu.contact_name || 'no contact'}${cu.email ? `, ${cu.email}` : ''}${cu.phone ? `, ${cu.phone}` : ''}. ${cu.address ? `${cu.address}, ` : 'NO ADDRESS ON FILE. '}${cu.city || ''}`);
    l.push(`  Terms ${cu.terms_days} days, limit ${cu.credit_limit_cents === null ? 'cash account' : money(cu.credit_limit_cents)}. Terms signed: ${isoDate(cu.terms_signed_on) || 'NEVER'}. PPSR: ${isoDate(cu.ppsr_registered_on) || 'NOT REGISTERED'}.`);
    l.push(`  Owing ${money(pos.owing_cents)} + unbilled ${money(pos.unbilled_cents)} = exposure ${money(pos.exposure_cents)}${pos.credit_limit_cents !== null && num(pos.exposure_cents) > num(pos.credit_limit_cents) ? ' (OVER THE LIMIT)' : ''}. Last order ${pos.last_order_on ? `${isoDate(pos.last_order_on)} (${pos.quiet_days}d ago)` : 'never'}.`);
    if (cu.note) l.push(`  Note: ${cu.note}`);
    if (orders.length) {
      l.push('  Orders:');
      for (const o of orders) l.push(`    ${o.so_no}  ${isoDate(o.ordered_on)}  ${o.status}${num(o.units_unshipped) > 0 && ['open', 'part'].includes(o.status) ? ` (${o.units_unshipped} unshipped)` : ''}  ${money(o.value_cents)}`);
    }
    for (const i of invoices) l.push(`  ${i.number}  ${isoDate(i.issued_on)}  ${i.status}  ${money(i.total_cents)}`);
    for (const t of tasks) l.push(`  Task: ${t.title} (due ${isoDate(t.due_on) || 'no date'})`);
    for (const n of notes) l.push(`  Note ${isoDate(n.created_at)}: ${n.body}`);
    return l.join('\n');
  });
}

async function cmdCustomerSet(db, args, flags) {
  const cu = await resolve(db, 'customer', args.join(' '));
  const sets = [];
  const vals = [cu.id];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (flags.address !== undefined) add('address', str(flags.address) || null);
  if (flags.city !== undefined) add('city', str(flags.city) || null);
  if (flags.email !== undefined) add('email', str(flags.email) || null);
  if (flags.phone !== undefined) add('phone', str(flags.phone) || null);
  if (flags.contact !== undefined) add('contact_name', str(flags.contact) || null);
  if (flags.tier !== undefined) add('price_tier', str(flags.tier).toLowerCase());
  if (flags.terms !== undefined) add('terms_days', parseQty(flags.terms, 'terms'));
  if (flags.limit !== undefined) add('credit_limit_cents', flags.limit === 'none' ? null : parseMoney(flags.limit));
  if (flags['terms-signed'] !== undefined) add('terms_signed_on', flags['terms-signed'] === true ? today() : parseDate(flags['terms-signed']));
  if (flags.ppsr !== undefined) add('ppsr_registered_on', flags.ppsr === true ? today() : parseDate(flags.ppsr));
  if (flags.note !== undefined) add('note', str(flags.note) || null);
  if (!sets.length) throw new CliError('customer set <name> takes --address= --city= --email= --phone= --contact= --tier= --terms= --limit= --terms-signed=<date> --ppsr=<date> --note=');
  const [row] = await db.query(`update customers set ${sets.join(', ')} where id = $1 returning *`, vals);
  out(row, `${cu.name} updated.`);
}

async function cmdQuiet(db, flags) {
  const days = num(flags.days) || 45;
  const rows = await db.query(
    `select cp.*, cu.contact_name, cu.email, cu.phone from v_customer_position cp
     join customers cu on cu.id = cp.customer_id
     where cp.status = 'active' and not cp.on_stop and cp.last_order_on is not null and cp.quiet_days > $1
     order by cp.quiet_days desc`,
    [days],
  );
  out(rows, () => heading(`Gone quiet (${rows.length}: no order in ${days} days)`) + '\n' + table(rows, [
    { key: 'customer', label: 'Customer', width: 32 },
    { key: 'quiet_days', label: 'Quiet', align: 'right', format: (v) => `${v}d` },
    { key: 'last_order_on', label: 'Last order', format: isoDate },
    { key: 'contact_name', label: 'Contact' },
    { key: 'phone', label: 'Phone' },
  ]) + (rows.length ? '\n\n  A quiet regular is usually buying from someone else. Call before assuming.' : ''));
}

async function cmdSuppliers(db) {
  const rows = await db.query(
    `select s.*,
            (select count(*) from purchase_orders po where po.supplier_id = s.id and po.status in ('open', 'part')) as open_pos,
            (select count(*) from products p where p.supplier_id = s.id and p.active) as products
     from suppliers s where s.active order by s.name`,
  );
  out(rows, () => heading(`Suppliers (${rows.length})`) + '\n' + table(rows, [
    { key: 'name', label: 'Supplier', width: 32 },
    { key: 'contact_name', label: 'Contact' },
    { key: 'phone', label: 'Phone' },
    { key: 'lead_time_days', label: 'Lead', align: 'right', format: (v) => `${v}d` },
    { key: 'products', label: 'Products', align: 'right' },
    { key: 'open_pos', label: 'Open POs', align: 'right' },
  ]));
}

async function cmdSupplier(db, args) {
  const s = await resolve(db, 'supplier', args.join(' '));
  const products = await db.query('select sku, name, cost_cents from products where supplier_id = $1 and active order by sku', [s.id]);
  const pos = await db.query(
    'select po.*, coalesce((select sum(l.qty - l.qty_received) from po_lines l where l.po_id = po.id), 0) as units_open from purchase_orders po where po.supplier_id = $1 order by po.ordered_on desc limit 6',
    [s.id],
  );
  out({ supplier: s, products, purchase_orders: pos }, () => {
    const l = [heading(`${s.name} (${s.lead_time_days}d lead)`)];
    l.push(`  ${s.contact_name || 'no contact'}${s.email ? `, ${s.email}` : ''}${s.phone ? `, ${s.phone}` : ''}. ${s.city || ''}`);
    for (const p of products) l.push(`  ${p.sku}  ${truncate(p.name, 40)}  cost ${priceFmt(p.cost_cents)}`);
    for (const po of pos) l.push(`  ${po.po_no}  ${isoDate(po.ordered_on)}  ${po.status}${num(po.units_open) > 0 ? ` (${po.units_open} units open)` : ''}`);
    return l.join('\n');
  });
}

async function cmdStop(db, args, on) {
  const cu = await resolve(db, 'customer', args.join(' '));
  await db.query('update customers set on_stop = $2 where id = $1', [cu.id, on]);
  out({ customer: cu.name, on_stop: on }, `${cu.name} ${on ? 'is now ON STOP: new orders refuse until it comes off' : 'is off stop'}.`);
}

async function cmdProducts(db, flags) {
  const rows = await db.query(
    `select p.*, s.name as supplier from products p left join suppliers s on s.id = p.supplier_id
     ${flags.all ? '' : 'where p.active'} order by p.sku`,
  );
  out(rows, () => heading(`Products (${rows.length})`) + '\n' + table(rows, [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product', width: 36 },
    { key: 'category', label: 'Category' },
    { key: 'cost_cents', label: 'Cost', align: 'right', format: (v) => priceFmt(v) },
    { key: 'price_cents', label: 'List', align: 'right', format: (v) => (num(v) > 0 ? priceFmt(v) : 'NO PRICE') },
    { key: 'hazardous', label: 'Haz', format: (v, r) => (v ? `class ${r.haz_class}` : '') },
    { key: 'supplier', label: 'Supplier', width: 26 },
  ]));
}

async function cmdAdd(db, args, flags) {
  const kind = args[0];
  if (kind === 'customer') {
    const name = args.slice(1).join(' ');
    if (!name) throw new CliError('add customer <name> [--contact= --email= --phone= --address= --city= --tier= --terms= --limit= --code=]');
    const [row] = await db.query(
      `insert into customers (name, code, contact_name, email, phone, address, city, price_tier, terms_days, credit_limit_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [name, str(flags.code) || null, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null,
       str(flags.address) || null, str(flags.city) || null, str(flags.tier).toLowerCase() || 'standard',
       flags.terms !== undefined ? parseQty(flags.terms) : 20, flags.limit !== undefined ? parseMoney(flags.limit) : null],
    );
    out(row, `Added customer ${name}. Terms signed and PPSR: record them when they exist (\`customer set\`); /compliance watches both.`);
    return;
  }
  if (kind === 'supplier') {
    const name = args.slice(1).join(' ');
    if (!name) throw new CliError('add supplier <name> [--contact= --email= --phone= --city= --lead= --code=]');
    const [row] = await db.query(
      'insert into suppliers (name, code, contact_name, email, phone, city, lead_time_days) values ($1, $2, $3, $4, $5, $6, $7) returning *',
      [name, str(flags.code) || null, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null, str(flags.city) || null, flags.lead !== undefined ? parseQty(flags.lead) : 7],
    );
    out(row, `Added supplier ${name} (${row.lead_time_days}d lead).`);
    return;
  }
  if (kind === 'product') {
    const sku = args[1];
    if (!sku || !flags.name) throw new CliError('add product <sku> --name="..." [--category= --unit= --pack= --cost= --price= --reorder-point= --reorder-qty= --supplier= --hazardous --haz-class= --haz-max=]');
    const supplier = flags.supplier ? await resolve(db, 'supplier', flags.supplier) : null;
    const [row] = await db.query(
      `insert into products (sku, name, category, unit, pack_size, cost_cents, price_cents, reorder_point, reorder_qty, supplier_id, hazardous, haz_class, haz_max_qty)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
      [sku.toUpperCase(), str(flags.name), str(flags.category) || null, str(flags.unit) || 'each',
       flags.pack !== undefined ? parseQty(flags.pack) : null, parseMoney(flags.cost), parseMoney(flags.price),
       flags['reorder-point'] !== undefined ? parseQty(flags['reorder-point']) : 0,
       flags['reorder-qty'] !== undefined ? parseQty(flags['reorder-qty']) : 0,
       supplier ? supplier.id : null, Boolean(flags.hazardous), str(flags['haz-class']) || null,
       flags['haz-max'] !== undefined ? parseQty(flags['haz-max']) : null],
    );
    out(row, `Added ${row.sku}${num(row.price_cents) > 0 ? '' : ' with NO PRICE: set one before it goes on an order'}.`);
    return;
  }
  if (kind === 'warehouse') {
    const code = args[1];
    if (!code) throw new CliError('add warehouse <code> [--name= --city=]');
    const [row] = await db.query('insert into warehouses (code, name, city) values ($1, $2, $3) returning *', [code.toUpperCase(), str(flags.name) || null, str(flags.city) || null]);
    out(row, `Added warehouse ${row.code}.`);
    return;
  }
  throw new CliError('add customer|supplier|product|warehouse ...');
}

// ---------------------------------------------------------------------------
// The office

async function cmdLog(db, args, flags) {
  const body = args.join(' ');
  if (!body) throw new CliError('log <what happened> [--customer=] [--so=]');
  const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
  const so = flags.so ? await resolve(db, 'so', flags.so) : null;
  const [row] = await db.query(
    'insert into notes (customer_id, so_id, body) values ($1, $2, $3) returning *',
    [cu ? cu.id : (so ? so.customer_id : null), so ? so.id : null, body],
  );
  out(row, `Logged${cu ? ` on ${cu.name}` : ''}${so ? ` (${so.so_no})` : ''}.`);
}

async function cmdTasks(db, flags) {
  const rows = await db.query(
    `select t.*, cu.name as customer from tasks t left join customers cu on cu.id = t.customer_id
     ${flags.all ? '' : "where t.status = 'open'"} order by t.due_on nulls last`,
  );
  out(rows, () => heading(`Tasks (${rows.length}${flags.all ? '' : ' open'})`) + '\n' + table(rows, [
    { key: 'title', label: 'Task', width: 48 },
    { key: 'customer', label: 'Customer', width: 28 },
    { key: 'due_on', label: 'Due', format: (v, r) => isoDate(v) + (r.status === 'open' && v && isoDate(v) < today() ? ' OVERDUE' : '') },
    { key: 'status', label: 'Status' },
  ]));
}

async function cmdTask(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const title = args.slice(1).join(' ');
    if (!title) throw new CliError('task add <title> [--customer=] [--due=]');
    const cu = flags.customer ? await resolve(db, 'customer', flags.customer) : null;
    const [row] = await db.query('insert into tasks (title, customer_id, due_on) values ($1, $2, $3) returning *', [title, cu ? cu.id : null, parseDate(flags.due)]);
    out(row, `Task added${row.due_on ? `, due ${isoDate(row.due_on)}` : ''}.`);
    return;
  }
  if (sub === 'done') {
    const t = await resolve(db, 'task', args.slice(1).join(' '));
    await db.query("update tasks set status = 'done', done_on = now()::date where id = $1", [t.id]);
    out({ id: t.id, status: 'done' }, `Done: ${t.title}`);
    return;
  }
  throw new CliError('task add <title> | task done <title>');
}

async function cmdCompliance(db, only) {
  const results = [];
  for (const rule of RULES) {
    if (only && rule.key !== only && !rule.key.startsWith(only)) continue;
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  if (!results.length) throw new CliError(`No rule matches "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  out(results, () => {
    const l = [heading('Compliance, checked against the data')];
    for (const r of results) {
      l.push(`\n${r.breaches.length ? 'BREACH' : '  ok  '}  ${r.title} (${r.key})`);
      if (r.breaches.length) {
        for (const b of r.breaches.slice(0, 8)) l.push(`          ${Object.values(b).map((v) => (v === null ? '' : v)).join('  ')}`);
        if (r.breaches.length > 8) l.push(`          ... and ${r.breaches.length - 8} more`);
        l.push(`          Fix: ${r.fix}`);
      }
    }
    l.push('\n  Sources for every rule: docs/compliance.md. Nothing here is legal advice; it is your rule book, enforced.');
    return l.join('\n');
  });
}

async function cmdStats(db) {
  const [s] = await db.query(`
    select
      (select count(*) from v_order_board where status in ('open', 'part', 'on-hold')) as open_orders,
      (select count(*) from v_backorders) as backorder_lines,
      (select coalesce(sum(qty_short), 0) from v_backorders) as units_backordered,
      (select count(*) from v_reorder) as reorder_due,
      (select coalesce(sum(value_cents), 0) from v_unbilled) as unbilled_cents,
      (select coalesce(sum(total_cents), 0) from v_debtors where status = 'sent') as owing_cents,
      (select coalesce(sum(total_cents), 0) from v_debtors where days_overdue > 0) as overdue_cents,
      (select coalesce(sum(sp.on_hand * sp.cost_cents), 0) from v_stock_position sp where sp.on_hand > 0) as stock_value_cents,
      (select coalesce(sum(value_cents), 0) from v_dead_stock) as dead_stock_cents,
      (select count(*) from purchase_orders where status in ('open', 'part')) as open_pos,
      (select count(*) from v_customer_position where status = 'active' and last_order_on is not null and quiet_days > 45 and not on_stop) as quiet_customers,
      (select count(*) from v_attention) as attention,
      (select count(*) from tasks where status = 'open') as open_tasks
  `);
  const stats = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
  out(stats, () => heading('The week in numbers') + `
  Open sales orders: ${stats.open_orders} (${stats.backorder_lines} backordered lines, ${stats.units_backordered} units short)
  Reorder run: ${stats.reorder_due} products under their point
  Shipped, not billed: ${money(stats.unbilled_cents)}
  Owing (sent invoices): ${money(stats.owing_cents)} (${money(stats.overdue_cents)} overdue)
  Stock on the shelf at cost: ${money(stats.stock_value_cents)} (${money(stats.dead_stock_cents)} of it dead)
  Open purchase orders: ${stats.open_pos}
  Regulars gone quiet: ${stats.quiet_customers}
  Attention list: ${stats.attention} items. Open tasks: ${stats.open_tasks}.`);
}

// ---------------------------------------------------------------------------
// Import from Unleashed (or anything that exports CSV)

async function cmdImport(db, args, flags) {
  const source = args[0] || 'unleashed';
  const dry = Boolean(flags['dry-run']);
  const readFile = (flag, what) => {
    const p = str(flags[flag]);
    if (!p) return null;
    if (!existsSync(p)) throw new CliError(`No ${what} file at ${p}.`);
    return parseCsv(readFileSync(p, 'utf8'));
  };
  const suppliersCsv = readFile('suppliers', 'suppliers');
  const customersCsv = readFile('customers', 'customers');
  const productsCsv = readFile('products', 'products');
  const stockCsv = readFile('stock', 'stock on hand');
  if (!suppliersCsv && !customersCsv && !productsCsv && !stockCsv) {
    throw new CliError(`Nothing to import. Give me --customers=, --products=, --suppliers= and/or --stock= CSV files exported from ${source}. See docs/replace-unleashed.md.`);
  }
  const counts = {
    suppliers: 0, suppliers_updated: 0, customers: 0, customers_updated: 0,
    products: 0, products_updated: 0, stock_lines: 0, skipped: [],
  };
  const termsDays = (v) => {
    const m = String(v || '').match(/(\d+)/);
    return m ? Number(m[1]) : 20;
  };

  if (suppliersCsv) {
    for (const row of suppliersCsv) {
      const name = pick(row, 'Supplier Name', 'Supplier', 'Name');
      if (!name) continue;
      const ext = `${source}:sup:${(pick(row, 'Supplier Code', 'Code') || name).toLowerCase()}`;
      const vals = [name, pick(row, 'Supplier Code', 'Code') || null,
        pick(row, 'Contact Name', 'Contact', 'Primary Contact') || null,
        pick(row, 'Email', 'Email Address') || null, pick(row, 'Phone', 'Phone Number', 'Office Phone') || null,
        pick(row, 'City', 'Town', 'Physical City') || null, termsDays(pick(row, 'Lead Time', 'Lead Time Days')) || 7];
      const existing = await db.query('select id from suppliers where external_ref = $1 or lower(name) = lower($2)', [ext, name]);
      if (dry) { existing.length ? counts.suppliers_updated++ : counts.suppliers++; continue; }
      if (existing.length) {
        await db.query('update suppliers set name=$2, code=$3, contact_name=$4, email=$5, phone=$6, city=$7, lead_time_days=$8, external_ref=coalesce(external_ref, $9) where id=$1', [existing[0].id, ...vals, ext]);
        counts.suppliers_updated++;
      } else {
        await db.query('insert into suppliers (name, code, contact_name, email, phone, city, lead_time_days, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8)', [...vals, ext]);
        counts.suppliers++;
      }
    }
  }

  if (customersCsv) {
    for (const row of customersCsv) {
      const name = pick(row, 'Customer Name', 'Customer', 'Name', 'Company');
      if (!name) continue;
      const ext = `${source}:cust:${(pick(row, 'Customer Code', 'Code') || name).toLowerCase()}`;
      const tierRaw = (pick(row, 'Sell Price Tier', 'Price Tier', 'Tier') || 'standard').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const vals = [name, pick(row, 'Customer Code', 'Code') || null,
        pick(row, 'Contact Name', 'Contact', 'Primary Contact') || null,
        pick(row, 'Email', 'Email Address') || null, pick(row, 'Phone', 'Phone Number', 'Office Phone', 'Mobile') || null,
        pick(row, 'Address Line 1', 'Physical Address', 'Address', 'Street') || null,
        pick(row, 'City', 'Town', 'Physical City', 'Suburb') || null,
        tierRaw || 'standard', termsDays(pick(row, 'Payment Term', 'Payment Terms', 'Terms'))];
      const existing = await db.query('select id from customers where external_ref = $1 or lower(name) = lower($2)', [ext, name]);
      if (dry) { existing.length ? counts.customers_updated++ : counts.customers++; continue; }
      if (existing.length) {
        await db.query('update customers set name=$2, code=$3, contact_name=$4, email=$5, phone=$6, address=$7, city=$8, price_tier=$9, terms_days=$10, external_ref=coalesce(external_ref, $11) where id=$1', [existing[0].id, ...vals, ext]);
        counts.customers_updated++;
      } else {
        await db.query('insert into customers (name, code, contact_name, email, phone, address, city, price_tier, terms_days, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [...vals, ext]);
        counts.customers++;
      }
    }
  }

  if (productsCsv) {
    for (const row of productsCsv) {
      const sku = pick(row, 'Product Code', 'SKU', 'Code', 'Item Code');
      const name = pick(row, 'Product Description', 'Description', 'Product Name', 'Name');
      if (!sku || !name) continue;
      const ext = `${source}:prod:${sku.toLowerCase()}`;
      const cost = Math.round(Number(pick(row, 'Average Land Price', 'Average Landed Cost', 'Last Cost', 'Cost', 'Default Purchase Price') || 0) * 100);
      const sell = Math.round(Number(pick(row, 'Sell Price Tier 1', 'Default Sell Price', 'Sell Price', 'Price') || 0) * 100);
      const vals = [sku.toUpperCase(), name, pick(row, 'Product Group', 'Category', 'Group') || null,
        (pick(row, 'Unit of Measure', 'Unit', 'UOM') || 'each').toLowerCase(),
        Number(pick(row, 'Pack Size') || 0) || null, cost, sell,
        Number(pick(row, 'Min Stock Alert Level', 'Re-order Point', 'Reorder Point', 'Minimum Stock') || 0),
        Number(pick(row, 'Max Stock Alert Level', 'Re-order Quantity', 'Reorder Quantity') || 0)];
      const existing = await db.query('select id from products where external_ref = $1 or lower(sku) = lower($2)', [ext, sku]);
      if (dry) { existing.length ? counts.products_updated++ : counts.products++; continue; }
      if (existing.length) {
        await db.query('update products set sku=$2, name=$3, category=$4, unit=$5, pack_size=$6, cost_cents=$7, price_cents=$8, reorder_point=$9, reorder_qty=$10, external_ref=coalesce(external_ref, $11) where id=$1', [existing[0].id, ...vals, ext]);
        counts.products_updated++;
      } else {
        await db.query('insert into products (sku, name, category, unit, pack_size, cost_cents, price_cents, reorder_point, reorder_qty, external_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [...vals, ext]);
        counts.products++;
      }
    }
  }

  if (stockCsv) {
    for (const row of stockCsv) {
      const sku = pick(row, 'Product Code', 'SKU', 'Code', 'Item Code');
      const qty = Number(pick(row, 'On Hand', 'Qty On Hand', 'Quantity On Hand', 'QtyOnHand', 'Quantity') || 0);
      if (!sku) continue;
      const whCode = (pick(row, 'Warehouse Code', 'Warehouse', 'Warehouse Name', 'Location') || 'MAIN').toUpperCase();
      const prod = await db.query('select id from products where lower(sku) = lower($1)', [sku]);
      if (!prod.length) { counts.skipped.push(`stock ${sku}: unknown product (import products first)`); continue; }
      if (dry) { counts.stock_lines++; continue; }
      let [wh] = await db.query('select id from warehouses where lower(code) = lower($1)', [whCode]);
      if (!wh) [wh] = await db.query('insert into warehouses (code) values ($1) returning id', [whCode]);
      const have = await onHand(db, prod[0].id, wh.id);
      const delta = qty - have;
      if (delta !== 0) {
        await db.query(
          "insert into stock_moves (product_id, warehouse_id, qty, kind, reason) values ($1, $2, $3, 'count', $4)",
          [prod[0].id, wh.id, delta, `Imported from ${source}: on hand ${qty}`],
        );
      }
      counts.stock_lines++;
    }
  }

  out(counts, () => {
    const l = [heading(dry ? 'Import dry run (nothing written)' : 'Imported')];
    l.push(`  Suppliers: ${counts.suppliers} new, ${counts.suppliers_updated} updated.`);
    l.push(`  Customers: ${counts.customers} new, ${counts.customers_updated} updated.`);
    l.push(`  Products: ${counts.products} new, ${counts.products_updated} updated.`);
    l.push(`  Stock lines: ${counts.stock_lines} set to the exported on-hand (as counted stocktake moves).`);
    for (const s of counts.skipped) l.push(`  skipped: ${s}`);
    if (!dry) l.push('  Open orders, price lists and history start from cutover: docs/replace-unleashed.md says why, and what to walk the warehouse with on cutover weekend.');
    return l.join('\n');
  });
}

async function cmdExport(db, flags) {
  const tables = ['warehouses', 'suppliers', 'customers', 'products', 'prices', 'sales_orders', 'so_lines', 'purchase_orders', 'po_lines', 'stock_moves', 'invoices', 'invoice_lines', 'notes', 'tasks'];
  const dump = { exported_at: new Date().toISOString() };
  const counts = {};
  for (const t of tables) {
    dump[t] = await db.query(`select * from ${t}`);
    counts[t] = dump[t].length;
  }
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `wholesale-${today()}.json`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(dump, null, 2));
  out({ file, counts }, `Exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows to ${file}.`);
}

// ---------------------------------------------------------------------------
// Output

let JSON_MODE = false;
function out(json, text) {
  if (JSON_MODE) console.log(JSON.stringify(json, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

// ---------------------------------------------------------------------------
// Help

const HELP = `wholesale-for-claude-code: the CLI. Any command takes --json.

The orders
  board [--all] [--customer=]         every open sales order; --all includes history
  so <ref>                            one order's whole story
  order create <customer> [--ref= --required= --warehouse=]
  order add <so> <sku> <qty> [--price= --allow-below-cost]
  ship <so> [--at=]                   ships what stock allows, backorders the rest, loudly
  hold <so> --reason=   release <so>   cancel <so> --reason=
  backorders                          every short quantity, with the inbound PO or its absence

The stock
  stock [--warehouse=] [--all]        on hand, allocated, available, on order
  product <sku>                       one product's whole card
  product set <sku> [--cost= --price= --reorder-point= --haz-max= ...]
  moves <sku> [--days=]               the ledger: every unit explained
  adjust <sku> <qty> --reason=        reasons are not optional
  adjust reason <move-id> "..."       backfill the reason an old adjustment never had
  count <sku> <qty> [--warehouse=]    stocktake: write the shelf's truth into the book
  reorder                             what to buy, from points, demand and lead times
  deadstock                           held 90+ days, no sales, cash on a shelf

The buying
  pos [--all]    po <ref>             purchase orders
  po create <supplier> [--expected= --warehouse=]
  po add <po> <sku> <qty> [--cost=]
  receive <po> [<sku> <qty>] [--at=]  receipts update the product's current cost

The money
  prices [customer]    price set <sku> --price= [--customer=|--tier=]    price check
  bill [customer] [--dry-run]         draft invoices for shipped uninvoiced goods, GST on its own line
  invoices [--all]    invoice <no>    invoice sent <no>    invoice paid <no>
  debtors    margins                  margins are stamped at entry, never rewritten

The accounts
  customers    customer <name>        customer set <name> [--address= --terms-signed= --ppsr= ...]
  quiet [--days=45]                   regulars who stopped ordering
  suppliers    supplier <name>
  products [--all]
  stop <name>    unstop <name>
  add customer|supplier|product|warehouse ...

The office
  attention                           everything that wants a decision, worst first
  compliance [rule]                   the rule book against the records
  stats    log <text> [--customer=|--so=]    tasks    task add|done
  import unleashed --products= --customers= --suppliers= --stock= [--dry-run]
  export [--out=]
`;

// ---------------------------------------------------------------------------
// Dispatch

async function main() {
  const { args: argv, flags } = parseArgv(process.argv.slice(2));
  JSON_MODE = Boolean(flags.json);
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  const db = await getDb();
  try {
    switch (cmd) {
      case 'attention': await cmdAttention(db); break;
      case 'board': case 'orders': await cmdBoard(db, flags); break;
      case 'so': await cmdSo(db, args[0]); break;
      case 'order':
        if (args[0] === 'create') await cmdOrderCreate(db, args.slice(1), flags);
        else if (args[0] === 'add') await cmdOrderAdd(db, args.slice(1), flags);
        else throw new CliError('order create <customer> | order add <so> <sku> <qty>');
        break;
      case 'ship': await cmdShip(db, args, flags); break;
      case 'hold': await cmdHold(db, args, flags); break;
      case 'release': await cmdRelease(db, args); break;
      case 'cancel': await cmdCancel(db, args, flags); break;
      case 'backorders': await cmdBackorders(db); break;
      case 'reorder': await cmdReorder(db); break;
      case 'pos': await cmdPos(db, flags); break;
      case 'po':
        if (args[0] === 'create') await cmdPoCreate(db, args.slice(1), flags);
        else if (args[0] === 'add') await cmdPoAdd(db, args.slice(1), flags);
        else await cmdPoCard(db, args[0]);
        break;
      case 'receive': await cmdReceive(db, args, flags); break;
      case 'stock': await cmdStock(db, flags); break;
      case 'product': await cmdProduct(db, args, flags); break;
      case 'products': await cmdProducts(db, flags); break;
      case 'moves': await cmdMoves(db, args, flags); break;
      case 'adjust': await cmdAdjust(db, args, flags); break;
      case 'count': await cmdCount(db, args, flags); break;
      case 'deadstock': await cmdDeadstock(db); break;
      case 'prices': await cmdPrices(db, args); break;
      case 'price':
        if (args[0] === 'set') await cmdPriceSet(db, args.slice(1), flags);
        else if (args[0] === 'check') await cmdPriceCheck(db);
        else throw new CliError('price set <sku> --price= [--customer=|--tier=] | price check');
        break;
      case 'bill': await cmdBill(db, args, flags); break;
      case 'invoices': await cmdInvoices(db, flags); break;
      case 'invoice': await cmdInvoice(db, args, flags); break;
      case 'debtors': await cmdDebtors(db); break;
      case 'margins': await cmdMargins(db, flags); break;
      case 'customers': await cmdCustomers(db); break;
      case 'customer': await cmdCustomer(db, args, flags); break;
      case 'quiet': await cmdQuiet(db, flags); break;
      case 'suppliers': await cmdSuppliers(db); break;
      case 'supplier': await cmdSupplier(db, args); break;
      case 'stop': await cmdStop(db, args, true); break;
      case 'unstop': await cmdStop(db, args, false); break;
      case 'add': await cmdAdd(db, args, flags); break;
      case 'log': await cmdLog(db, args, flags); break;
      case 'tasks': await cmdTasks(db, flags); break;
      case 'task': await cmdTask(db, args, flags); break;
      case 'compliance': await cmdCompliance(db, args[0]); break;
      case 'stats': await cmdStats(db); break;
      case 'import': await cmdImport(db, args, flags); break;
      case 'export': await cmdExport(db, flags); break;
      default:
        throw new CliError(`Unknown command "${cmd}". Run \`help\` for the list.`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exit(err.code);
  }
  console.error(err);
  process.exit(1);
});
