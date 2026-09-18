#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'wholesale-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

// Local date, the same way the CLI computes "today". Never UTC: New Zealand is a day ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the board --------------------------------------------------------------

  const board = run('board', ['wholesale.mjs', 'board']);
  assert(board.length === 6, `six open sales orders (${board.length})`);
  const late = board.find((b) => b.so_no === 'SO-5101');
  assert(n(late.days_late) === 2 && late.status === 'open', 'the Cambridge order is 2 days past required');
  assert(board.some((b) => b.on_stop && b.status === 'on-hold'), 'the stopped account shows with its order held');
  assert(board.some((b) => b.so_no === 'SO-5103' && b.has_unpriced), 'the unpriced straw line flags its order');
  assert(board.some((b) => b.so_no === 'SO-5104' && b.has_below_cost), 'the below-cost coffee flags its order');

  const so = run('one order', ['wholesale.mjs', 'so', 'SO-5102']);
  assert(so.so.customer_name === 'Matamata Foodmarket Ltd' && so.so.status === 'part', 'resolved by order number');
  assert(so.lines.length === 1 && n(so.lines[0].qty) === 64 && n(so.lines[0].qty_shipped) === 40, '64 wanted, 40 shipped, 24 short');

  const byRef = run('resolve by customer ref', ['wholesale.mjs', 'so', 'TEC-81']);
  assert(byRef.so.so_no === 'SO-5103', 'TEC-81 resolves to SO-5103');

  const noSuch = run('an unknown order exits 1', ['wholesale.mjs', 'so', 'no such thing anywhere'], { json: false, expectFail: true });
  assert(/No so matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous match exits 1 and lists candidates', ['wholesale.mjs', 'so', 'SO-51'], { json: false, expectFail: true });
  assert(/matches \d+ so records/.test(ambiguous.stderr), 'with the candidates listed');

  // ---- the stock position -------------------------------------------------------

  const stock = run('stock position', ['wholesale.mjs', 'stock']);
  assert(stock.length === 16, `sixteen products in play (${stock.length})`);
  const deg = stock.find((s) => s.sku === 'CHEM-DEG-20L');
  assert(n(deg.on_hand) === 84 && n(deg.haz_max_qty) === 60, 'the degreaser sits 24 drums over its ceiling');
  const cups = stock.find((s) => s.sku === 'CUPS-8OZ');
  assert(n(cups.on_hand) === 4 && n(cups.allocated) === 24 && n(cups.available) === -20 && n(cups.on_order) === 60, 'the cup shortfall is covered on order');
  const ctn = stock.find((s) => s.sku === 'PACK-CTN-A3');
  assert(n(ctn.available) === -18 && n(ctn.on_order) === 0, 'the carton shortfall has nothing behind it');

  const whStock = run('stock in one warehouse', ['wholesale.mjs', 'stock', '--warehouse=TGA']);
  assert(whStock.length === 1 && whStock[0].sku === 'PAPER-TOWEL' && n(whStock[0].on_hand) === 40, 'Tauriko holds 40 cartons of towels');

  const coffee = run('one product card', ['wholesale.mjs', 'product', 'COFFEE-1KG']);
  assert(n(coffee.position.on_hand) === 55 && n(coffee.position.allocated) === 20, 'coffee: 55 on hand, 20 allocated');
  assert(coffee.prices.some((p) => n(p.price_cents) === 2600), 'the legacy Raglan price is on the card');

  const movesFoil = run('movement ledger', ['wholesale.mjs', 'moves', 'FOIL-CATER']);
  const badAdj = movesFoil.find((m) => m.kind === 'adjustment' && !m.reason);
  assert(badAdj && n(badAdj.qty) === -4, 'the unexplained foil adjustment is on the ledger');

  const reorder = run('reorder run', ['wholesale.mjs', 'reorder']);
  assert(reorder.length === 2, `two products under their reorder point (${reorder.length})`);
  assert(reorder.some((r) => r.sku === 'GLOVE-NIT-L') && assertReorderCarton(reorder), 'gloves and cartons need buying');
  function assertReorderCarton(rows) { return rows.some((r) => r.sku === 'PACK-CTN-A3'); }

  const backorders = run('backorders', ['wholesale.mjs', 'backorders']);
  assert(backorders.length === 2, `two backordered lines (${backorders.length})`);
  const boCtn = backorders.find((b) => b.sku === 'PACK-CTN-A3');
  assert(n(boCtn.qty_short) === 30 && boCtn.next_incoming_on === null, '30 carton bundles short with NO purchase order behind them');
  const boCup = backorders.find((b) => b.sku === 'CUPS-8OZ');
  assert(n(boCup.qty_short) === 24 && boCup.next_incoming_on !== null, '24 cup cartons short with the PO date to promise');

  const dead = run('dead stock', ['wholesale.mjs', 'deadstock']);
  assert(dead.length === 1 && dead[0].sku === 'BIN-240L' && n(dead[0].value_cents) === 166400, '$1,664 of bin liners asleep on a shelf');

  // ---- the money ----------------------------------------------------------------

  const customers = run('customers', ['wholesale.mjs', 'customers']);
  assert(customers.length === 12, `twelve customers (${customers.length})`);
  const whg = customers.find((c) => c.customer === 'Waikato Hospitality Group Ltd');
  assert(n(whg.exposure_cents) === 1509400 && n(whg.exposure_cents) > n(whg.credit_limit_cents), 'Waikato Hospitality is over its limit');

  const custCard = run('customer card', ['wholesale.mjs', 'customer', 'Hillcrest']);
  assert(custCard.customer.name === 'Hillcrest Superette Ltd', 'resolved by partial name');
  assert(custCard.customer.terms_signed_on === null && custCard.customer.ppsr_registered_on === null, 'with its missing paperwork showing');

  const quiet = run('gone quiet', ['wholesale.mjs', 'quiet']);
  assert(quiet.length === 1 && quiet[0].customer === 'Fieldays Catering Co Ltd' && n(quiet[0].quiet_days) === 62, 'Fieldays has been quiet 62 days');

  const margins = run('margins', ['wholesale.mjs', 'margins']);
  const coffeeMargin = margins.find((m) => m.sku === 'COFFEE-1KG');
  assert(coffeeMargin && n(coffeeMargin.margin_cents) === -4500, `the legacy coffee price lost $45 last month (${coffeeMargin && coffeeMargin.margin_cents})`);

  const debtors = run('debtors', ['wholesale.mjs', 'debtors']);
  assert(debtors.some((d) => d.number === 'INV-3110' && n(d.days_overdue) === 30), 'the 30 day overdue invoice shows');
  assert(debtors.some((d) => d.number === 'INV-3114' && d.status === 'draft'), 'so does the draft that never went out');

  const prices = run('prices for one customer', ['wholesale.mjs', 'prices', 'Raglan']);
  const raglanCoffee = prices.find((p) => p.sku === 'COFFEE-1KG');
  assert(n(raglanCoffee.effective_cents) === 2600 && n(raglanCoffee.cost_cents) === 2900, 'Raglan pays 26.00 against a 29.00 cost');

  const priceCheck = run('price check', ['wholesale.mjs', 'price', 'check']);
  assert(priceCheck.length === 1 && priceCheck[0].sku === 'STRAW-PAPER', 'only the straws have no price anywhere');

  // ---- attention and compliance -------------------------------------------------

  const attention = run('attention', ['wholesale.mjs', 'attention']);
  assert(attention.length === 18, `the attention list is loud (${attention.length})`);
  for (const reason of ['haz_over_threshold', 'backorder_no_po', 'reorder_due', 'po_overdue', 'so_late', 'so_stuck',
    'price_missing', 'below_cost', 'unbilled_shipped', 'invoice_overdue', 'invoice_draft', 'over_credit_limit',
    'customer_quiet', 'adjustment_no_reason', 'task_overdue']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention.filter((a) => a.reason === 'unbilled_shipped').length === 2, 'both unbilled shipments show');

  const compliance = run('compliance', ['wholesale.mjs', 'compliance']);
  assert(compliance.length === 6, 'six rules in the book');
  assert(compliance.every((r) => r.breaches.length > 0), 'every rule breached in the seed, deliberately');
  assert(compliance.find((r) => r.key === 'ppsr').breaches.length === 3, 'three credit accounts with no PPSR registration');
  const oneRule = run('one compliance rule', ['wholesale.mjs', 'compliance', 'hazardous']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'run one rule on its own');

  // ---- order entry and its gates -------------------------------------------------

  const stopped = run('ordering for a stopped account is refused', ['wholesale.mjs', 'order', 'create', 'CleanRight'], { json: false, expectFail: true });
  assert(/ON STOP/.test(stopped.stderr), 'and the refusal names the stop');

  const newOrder = run('create an order', ['wholesale.mjs', 'order', 'create', 'Hillcrest', '--ref=HSL-57', `--required=${todayIso}`]);
  assert(newOrder.so_no === 'SO-5106', `the order number is minted (${newOrder.so_no})`);

  const unpriced = run('an unpriced product books at $0, loudly', ['wholesale.mjs', 'order', 'add', 'SO-5106', 'STRAW-PAPER', '5']);
  assert(unpriced.price_missing === true && n(unpriced.price_cents) === 0, 'flagged price_missing');

  const manual = run('a manual price sticks', ['wholesale.mjs', 'order', 'add', 'SO-5106', 'SUGAR-STICK', '4', '--price=31']);
  assert(n(manual.price_cents) === 3100 && manual.price_desc === 'Manual', 'priced by hand at $31');

  const belowCost = run('selling below cost is refused', ['wholesale.mjs', 'order', 'add', 'SO-5104', 'COFFEE-1KG', '5'], { json: false, expectFail: true });
  assert(/below cost/.test(belowCost.stderr), 'and the refusal shows both numbers');
  const allowed = run('unless it is deliberate', ['wholesale.mjs', 'order', 'add', 'SO-5104', 'COFFEE-1KG', '5', '--allow-below-cost']);
  assert(n(allowed.price_cents) === 2600, 'the legacy price goes on when forced');

  // ---- shipping: stock never goes negative ----------------------------------------

  const heldShip = run('shipping a held order is refused', ['wholesale.mjs', 'ship', 'SO-5105'], { json: false, expectFail: true });
  assert(/on hold/.test(heldShip.stderr), 'the hold is a decision, not a queue');

  const partShip = run('ship what stock allows', ['wholesale.mjs', 'ship', 'SO-5103']);
  assert(partShip.status === 'part', 'the order goes part-shipped');
  assert(partShip.shipped.some((s) => s.sku === 'PACK-CTN-A3' && n(s.qty) === 12), 'all 12 carton bundles on hand went');
  assert(partShip.backordered.some((s) => s.sku === 'PACK-CTN-A3' && n(s.short) === 18), 'and 18 are honestly backordered');

  const fullShip = run('ship a covered order', ['wholesale.mjs', 'ship', 'SO-5100']);
  assert(fullShip.status === 'shipped', 'SO-5100 ships in full');

  run('an order for empty shelves', ['wholesale.mjs', 'order', 'create', 'Cambridge', '--ref=CML-241']);
  run('wanting 5 carton bundles', ['wholesale.mjs', 'order', 'add', 'SO-5107', 'PACK-CTN-A3', '5']);
  const noStock = run('shipping from an empty shelf is refused', ['wholesale.mjs', 'ship', 'SO-5107'], { json: false, expectFail: true });
  assert(/never goes negative/.test(noStock.stderr), 'stock never goes negative');

  // ---- receiving -----------------------------------------------------------------

  const pos = run('open purchase orders', ['wholesale.mjs', 'pos']);
  assert(pos.length === 2, `two open purchase orders (${pos.length})`);
  assert(pos.some((p) => p.po_no === 'PO-7418' && n(p.days_overdue) === 3), 'PO-7418 is 3 days overdue');

  const received = run('receive the overdue chemicals', ['wholesale.mjs', 'receive', 'PO-7418']);
  assert(received.status === 'received' && received.received.length === 2, 'both lines land');
  const overReceipt = run('over-receiving is refused', ['wholesale.mjs', 'receive', 'PO-7420', 'CUPS-8OZ', '100'], { json: false, expectFail: true });
  assert(/Over-receipts/.test(overReceipt.stderr), 'against the outstanding quantity');
  const partReceive = run('receive the cups, wrap still to come', ['wholesale.mjs', 'receive', 'PO-7420', 'CUPS-8OZ', '60']);
  assert(partReceive.status === 'part', 'the PO stays part-received');

  const cupsAfter = run('the cup cost moved to the PO cost', ['wholesale.mjs', 'product', 'CUPS-8OZ']);
  assert(n(cupsAfter.product.cost_cents) === 4700 && n(cupsAfter.position.on_hand) === 64, '64 on hand at the new 47.00 cost');

  const shipBackorder = run('the cup backorder ships', ['wholesale.mjs', 'ship', 'SO-5102']);
  assert(shipBackorder.status === 'shipped' && shipBackorder.shipped.some((s) => n(s.qty) === 24), 'the remaining 24 go');

  // ---- adjustments and counts ------------------------------------------------------

  const noReason = run('an adjustment with no reason is refused', ['wholesale.mjs', 'adjust', 'CHEM-DEG-20L', '-30'], { json: false, expectFail: true });
  assert(/reason/.test(noReason.stderr), 'the record demands a reason');
  const adjusted = run('the degreaser overstock goes back', ['wholesale.mjs', 'adjust', 'CHEM-DEG-20L', '-30', '--reason=Overstock returned to ChemSol under the buyback clause']);
  assert(n(adjusted.on_hand) === 54, `54 drums left, under the ceiling of 60 (${adjusted.on_hand})`);

  const reasonFix = run('the old foil adjustment gets its reason', ['wholesale.mjs', 'adjust', 'reason', String(badAdj.id).slice(0, 8), 'Damaged rolls dumped after the racking leak']);
  assert(reasonFix.reason.includes('racking leak'), 'backfilled onto the move');

  const counted = run('a stocktake writes the shelf truth', ['wholesale.mjs', 'count', 'GLOVE-NIT-L', '50', '--warehouse=HAM']);
  assert(n(counted.delta) === 6 && n(counted.on_hand) === 50, 'counted 50, book said 44, wrote +6');

  // ---- billing: what shipped, GST on its own line -----------------------------------

  const dryBill = run('bill --dry-run writes nothing', ['wholesale.mjs', 'bill', 'Anchor', '--dry-run']);
  assert(dryBill.dry_run === true && dryBill.invoices.length === 1 && n(dryBill.invoices[0].total_cents) === 86250, 'goods $750 + GST $112.50');
  const billed = run('bill one customer', ['wholesale.mjs', 'bill', 'Anchor']);
  assert(billed.invoices[0].number === 'INV-3115' && n(billed.invoices[0].total_cents) === 86250, `$862.50 drafted (${billed.invoices[0].total_cents})`);
  const billAll = run('bill the rest', ['wholesale.mjs', 'bill']);
  assert(billAll.invoices.length === 4, `four more drafts (${billAll.invoices.length})`);
  const whgInv = billAll.invoices.find((i) => i.customer === 'Waikato Hospitality Group Ltd');
  assert(n(whgInv.total_cents) === 148810, `Waikato goods plus GST (${whgInv.total_cents})`);
  const mfmInv = billAll.invoices.find((i) => i.customer === 'Matamata Foodmarket Ltd');
  assert(n(mfmInv.total_cents) === 581440, `all 64 shipped cup cartons billed (${mfmInv.total_cents})`);
  const nothing = run('billing again finds nothing', ['wholesale.mjs', 'bill'], { json: false, expectFail: true });
  assert(/Nothing billable/.test(nothing.stderr), 'the meter moved onto the invoices');

  run('send it', ['wholesale.mjs', 'invoice', 'sent', 'INV-3115']);
  run('it gets paid', ['wholesale.mjs', 'invoice', 'paid', 'INV-3115']);
  const draftPaid = run('a draft cannot be paid', ['wholesale.mjs', 'invoice', 'paid', 'INV-3114'], { json: false, expectFail: true });
  assert(/Only a sent invoice/.test(draftPaid.stderr), 'sent comes first');

  const invCard = run('one invoice with its lines', ['wholesale.mjs', 'invoice', 'INV-3115']);
  assert(invCard.lines.length === 3 && invCard.lines.some((l) => /GST 15%/.test(l.description)), 'GST is its own line');

  // ---- the buying loop closes the carton backorder ----------------------------------

  const newPo = run('raise the carton PO', ['wholesale.mjs', 'po', 'create', 'Pacific Packaging']);
  assert(newPo.po_no === 'PO-7421', `the PO number is minted (${newPo.po_no})`);
  run('100 bundles on it', ['wholesale.mjs', 'po', 'add', 'PO-7421', 'PACK-CTN-A3', '100']);
  const cartonsIn = run('they land', ['wholesale.mjs', 'receive', 'PO-7421']);
  assert(cartonsIn.status === 'received', 'received in full');
  const finishTeRapa = run('the carton backorder ships', ['wholesale.mjs', 'ship', 'SO-5103']);
  assert(finishTeRapa.status === 'shipped', 'SO-5103 completes');
  const lateBill = run('and the late shipment bills', ['wholesale.mjs', 'bill', 'Te Rapa']);
  assert(n(lateBill.invoices[0].total_cents) === 53820, `18 bundles plus GST (${lateBill.invoices[0].total_cents})`);

  const backordersAfter = run('the backorder list is empty', ['wholesale.mjs', 'backorders']);
  assert(backordersAfter.length === 0, 'nothing short anywhere');

  // ---- holds and cancels -------------------------------------------------------------

  const holdNoReason = run('a hold needs its reason', ['wholesale.mjs', 'hold', 'SO-5104'], { json: false, expectFail: true });
  assert(/--reason/.test(holdNoReason.stderr), 'the record demands it');
  run('hold with one', ['wholesale.mjs', 'hold', 'SO-5104', '--reason=Reviewing the legacy price before it ships']);
  run('release it', ['wholesale.mjs', 'release', 'SO-5104']);
  const cancelNoReason = run('cancelling needs a reason too', ['wholesale.mjs', 'cancel', 'SO-5107'], { json: false, expectFail: true });
  assert(/--reason/.test(cancelNoReason.stderr), 'on the record');
  run('cancel with one', ['wholesale.mjs', 'cancel', 'SO-5107', '--reason=Customer keyed it twice']);

  // ---- fix the compliance story, watch the book come clean ----------------------------

  run('the missing address turns up', ['wholesale.mjs', 'customer', 'set', 'Te Rapa Event', '--address=100 Te Rapa Rd', '--city=Hamilton']);
  run('PPSR lodged for Waikato', ['wholesale.mjs', 'customer', 'set', 'Waikato Hospitality', `--ppsr=${todayIso}`]);
  run('Hillcrest returns signed terms, PPSR lodged', ['wholesale.mjs', 'customer', 'set', 'Hillcrest', `--terms-signed=${todayIso}`, `--ppsr=${todayIso}`]);
  run('PPSR lodged for Pukete', ['wholesale.mjs', 'customer', 'set', 'Pukete', `--ppsr=${todayIso}`]);
  run('the fat-fingered dish price becomes the agreed price', ['wholesale.mjs', 'price', 'set', 'DET-DISH-5L', '--price=31', '--customer=Te Rapa Event']);
  // Receiving PO-7418 pushed bleach to 86 drums against its declared ceiling
  // of 80: the hazardous rule caught a real consequence of a receipt. The
  // store gets its location compliance certificate extended.
  run('the bleach ceiling is re-certified', ['wholesale.mjs', 'product', 'set', 'CHEM-BLE-10L', '--haz-max=100']);

  const complianceAfter = run('the compliance book comes clean', ['wholesale.mjs', 'compliance']);
  const failing = complianceAfter.filter((r) => r.breaches.length).map((r) => r.key);
  assert(failing.length === 0, `every rule now passes (still failing: ${failing.join(',') || 'none'})`);

  // ---- the office ----------------------------------------------------------------------

  run('log a call', ['wholesale.mjs', 'log', 'Louise called: payment run is Friday. Third Friday.', '--customer=Waikato Hospitality']);
  run('task done', ['wholesale.mjs', 'task', 'done', 'Chase the Waikato Hospitality account before month end']);
  run('add a customer', ['wholesale.mjs', 'add', 'customer', 'Frankton Bakehouse Ltd', '--contact=Rewi Hema', '--tier=trade', '--limit=2500']);
  run('add a product', ['wholesale.mjs', 'add', 'product', 'NAPKIN-CTN', '--name=Dinner napkins carton, 3000', '--category=hospitality', '--cost=21', '--price=36', '--reorder-point=10', '--reorder-qty=20', '--supplier=Pacific']);

  const stats = run('stats', ['wholesale.mjs', 'stats']);
  assert(n(stats.dead_stock_cents) === 166400 && n(stats.open_orders) > 0, 'stats agree with the lists');

  // ---- import from Unleashed -------------------------------------------------------------

  const productsCsv = path.join(dataDir, 'products.csv');
  const customersCsv = path.join(dataDir, 'customers.csv');
  const suppliersCsv = path.join(dataDir, 'suppliers.csv');
  const stockCsv = path.join(dataDir, 'stock.csv');
  writeFileSync(productsCsv, [
    'Product Code,Product Description,Product Group,Unit of Measure,Average Land Price,Sell Price Tier 1,Min Stock Alert Level,Re-order Quantity',
    'ECO-PLATE,"Compostable plates carton, 500",hospitality,carton,24.00,39.50,10,20',
    'PAPER-TOWEL,"Paper towel carton, 20 rolls",paper,carton,22.00,39.00,40,80',
  ].join('\n'));
  writeFileSync(customersCsv, [
    'Customer Code,Customer Name,Contact Name,Email,Payment Term,Sell Price Tier,Address Line 1,City',
    'FDL001,"Frankton Dairy Ltd",Nikau Rewiti,nikau@franktondairy.example.nz,20,Standard,8 Lake Rd,Hamilton',
    'MFM001,"Matamata Foodmarket Ltd",Harpreet Gill,store@matamatafood.example.nz,20,Trade,77 Broadway,Matamata',
  ].join('\n'));
  writeFileSync(suppliersCsv, [
    'Supplier Code,Supplier Name,Contact Name,Email,Lead Time',
    'ECO01,"EcoWare Imports Ltd",Petra Vos,petra@ecoware.example.nz,14',
  ].join('\n'));
  writeFileSync(stockCsv, [
    'Product Code,Warehouse Code,On Hand',
    'ECO-PLATE,HAM,25',
    'PAPER-TOWEL,HAM,150',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['wholesale.mjs', 'import', 'unleashed', `--products=${productsCsv}`, `--customers=${customersCsv}`, `--suppliers=${suppliersCsv}`, `--stock=${stockCsv}`, '--dry-run']);
  assert(n(dry.products) === 1 && n(dry.products_updated) === 1, 'the dry run counts products');
  assert(n(dry.customers) === 1 && n(dry.customers_updated) === 1 && n(dry.suppliers) === 1, 'and customers and suppliers');

  const imported = run('import for real', ['wholesale.mjs', 'import', 'unleashed', `--products=${productsCsv}`, `--customers=${customersCsv}`, `--suppliers=${suppliersCsv}`, `--stock=${stockCsv}`]);
  assert(n(imported.products) === 1 && n(imported.customers) === 1 && n(imported.stock_lines) === 2, 'and the real run does it');

  const ecoPlate = run('the imported product landed with its stock', ['wholesale.mjs', 'product', 'ECO-PLATE']);
  assert(n(ecoPlate.product.price_cents) === 3950 && n(ecoPlate.position.on_hand) === 25, '25 on hand at the exported sell price');
  const towelAfter = run('the counted towels landed', ['wholesale.mjs', 'product', 'PAPER-TOWEL']);
  assert(n(towelAfter.position.on_hand) === 190, `HAM counted to 150 plus 40 in Tauriko (${towelAfter.position.on_hand})`);

  const reimport = run('re-importing updates rather than duplicating', ['wholesale.mjs', 'import', 'unleashed', `--products=${productsCsv}`, `--customers=${customersCsv}`]);
  assert(n(reimport.products) === 0 && n(reimport.products_updated) === 2, 'the second run creates no products');
  assert(n(reimport.customers) === 0 && n(reimport.customers_updated) === 2, 'and no customers');

  const missingFile = run('a missing import file fails loudly', ['wholesale.mjs', 'import', 'unleashed', `--products=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No products file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export ---------------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['wholesale.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.products.length === n(dump.counts.products), 'the counts match the file');
  assert(parsed.stock_moves.length === n(dump.counts.stock_moves), 'the whole ledger included');

  // ---- the branded HTML ------------------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]ops\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const opsHtml = readFileSync(path.join(root, 'views', 'ops.html'), 'utf8');
  assert(opsHtml.includes('Needs a decision') && opsHtml.includes('Backorders'), 'the ops view has its sections');
  const moneyHtml = readFileSync(path.join(root, 'views', 'money.html'), 'utf8');
  assert(moneyHtml.includes('Ready to bill') && moneyHtml.includes('Customer exposure'), 'the money view has its sections');

  const docs = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/invoice/.test(docs.stdout), 'the tax invoices rendered');
  assert(/picking-slip/.test(docs.stdout), 'the picking slips rendered');
  assert(/purchase-order/.test(docs.stdout), 'the purchase orders rendered');
  assert(/price-list/.test(docs.stdout), 'the customer price lists rendered');

  // ---- the human readable side --------------------------------------------------------------

  run('board (text)', ['wholesale.mjs', 'board'], { json: false });
  run('so (text)', ['wholesale.mjs', 'so', 'SO-5104'], { json: false });
  run('backorders (text)', ['wholesale.mjs', 'backorders'], { json: false });
  run('reorder (text)', ['wholesale.mjs', 'reorder'], { json: false });
  run('stock (text)', ['wholesale.mjs', 'stock'], { json: false });
  run('product (text)', ['wholesale.mjs', 'product', 'CHEM-DEG-20L'], { json: false });
  run('moves (text)', ['wholesale.mjs', 'moves', 'CUPS-8OZ'], { json: false });
  run('deadstock (text)', ['wholesale.mjs', 'deadstock'], { json: false });
  run('pos (text)', ['wholesale.mjs', 'pos', '--all'], { json: false });
  run('po (text)', ['wholesale.mjs', 'po', 'PO-7420'], { json: false });
  run('prices (text)', ['wholesale.mjs', 'prices'], { json: false });
  run('prices for customer (text)', ['wholesale.mjs', 'prices', 'Waikato Hospitality'], { json: false });
  run('invoices (text)', ['wholesale.mjs', 'invoices', '--all'], { json: false });
  run('invoice (text)', ['wholesale.mjs', 'invoice', 'INV-3113'], { json: false });
  run('debtors (text)', ['wholesale.mjs', 'debtors'], { json: false });
  run('margins (text)', ['wholesale.mjs', 'margins'], { json: false });
  run('customers (text)', ['wholesale.mjs', 'customers'], { json: false });
  run('customer (text)', ['wholesale.mjs', 'customer', 'Waikato Hospitality'], { json: false });
  run('quiet (text)', ['wholesale.mjs', 'quiet'], { json: false });
  run('suppliers (text)', ['wholesale.mjs', 'suppliers'], { json: false });
  run('supplier (text)', ['wholesale.mjs', 'supplier', 'Pacific'], { json: false });
  run('products (text)', ['wholesale.mjs', 'products'], { json: false });
  run('tasks (text)', ['wholesale.mjs', 'tasks', '--all'], { json: false });
  run('attention (text)', ['wholesale.mjs', 'attention'], { json: false });
  run('compliance (text)', ['wholesale.mjs', 'compliance'], { json: false });
  run('stats (text)', ['wholesale.mjs', 'stats'], { json: false });
  run('help', ['wholesale.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['wholesale.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
