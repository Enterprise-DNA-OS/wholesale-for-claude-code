-- Demo data for wholesale-for-claude-code.
-- Kahikatea Trade Supplies, a fictional Hamilton wholesale distributor of
-- hospitality, packaging and cleaning lines: 2 warehouses, 4 suppliers,
-- 16 products, 12 account customers, 14 sales orders from entered to shipped,
-- 3 purchase orders, a stock ledger that explains every unit, six invoices.
--
-- Deliberately messy, so the attention list has something to say:
--   84 drums of class 8 degreaser on hand against a declared ceiling of 60
--   a backorder of 30 carton bundles with NO purchase order behind it
--   24 cartons of 8 oz cups short, covered by a PO due in 4 days
--   nitrile gloves and A3 cartons both under their reorder points
--   PO-7418 (bleach and sanitiser) 3 days past its expected date
--   SO-5101 two days past its required date, and nothing shipped on it or SO-5100
--   a paper straw line on SO-5103 priced $0 because the product was never priced
--   20 kg of coffee on SO-5104 at a legacy customer price below today's cost
--   $2,044 of shipped goods on no invoice (SO-5094 and SO-5095)
--   INV-3110 ($13,800) 30 days overdue, and a draft (INV-3114) never sent
--   Waikato Hospitality $94 over its $15,000 limit, CleanRight on stop
--   Fieldays Catering quiet for 62 days
--   4 rolls of foil adjusted out 5 days ago with no reason recorded
--   $1,664 of 240 L bin liners that have not sold in 120 days
--   no PPSR registration behind three credit accounts, no signed terms on one
--   the Waikato follow-up task 3 days past its date
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Prices and names are DEMO VALUES for a fictional company. No real business
-- or person is depicted, and nothing here is legal advice.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Warehouses -------------------------------------------------------------------

insert into warehouses (id, code, name, city, is_default) values
  (seed_uuid('wh:ham'), 'HAM', 'Te Rapa depot',   'Hamilton', true),
  (seed_uuid('wh:tga'), 'TGA', 'Tauriko depot',   'Tauranga', false)
on conflict do nothing;

-- Suppliers -------------------------------------------------------------------

insert into suppliers (id, name, code, contact_name, email, phone, city, lead_time_days, active, external_ref) values
  (seed_uuid('sup:chemsol'), 'ChemSol Distributors Ltd',      'CHEM01', 'Priya Naran',   'orders@chemsol.example.nz',      '09 555 0701', 'Auckland', 7,  true, 'UL-S001'),
  (seed_uuid('sup:pacific'), 'Pacific Packaging Imports Ltd', 'PACK01', 'Ray Louie',     'ray@pacificpack.example.nz',     '09 555 0702', 'Auckland', 21, true, 'UL-S002'),
  (seed_uuid('sup:kiwipap'), 'Kiwi Paper Products Ltd',       'KIWI01', 'Donna Heke',    'sales@kiwipaper.example.nz',     '07 555 0703', 'Tokoroa',  5,  true, 'UL-S003'),
  (seed_uuid('sup:aotea'),   'Aotea Coffee Roasters Ltd',     'AOTE01', 'Sam Ngata',     'sam@aotearoasters.example.nz',   '07 555 0704', 'Raglan',   3,  true, 'UL-S004')
on conflict do nothing;

-- Customers -------------------------------------------------------------------
-- Waikato Hospitality, Hillcrest and Pukete hold credit with no PPSR
-- registration behind the retention of title. Hillcrest also has no signed
-- terms on file. Te Rapa Event Centre has no address on file and an invoice
-- over $1,000: exactly what the taxable supply information rule catches.

insert into customers (id, name, code, contact_name, email, phone, address, city, price_tier, terms_days, credit_limit_cents, on_stop, terms_signed_on, ppsr_registered_on, status, note, external_ref) values
  (seed_uuid('cust:waikatohosp'), 'Waikato Hospitality Group Ltd', 'WHG001', 'Louise Kaur',   'accounts@waikatohosp.example.nz',  '07 555 0501', '12 Alexandra St',   'Hamilton',   'gold',     20, 1500000, false, current_date - 300, null,               'active', 'Runs eight venues. Biggest account.', 'UL-C001'),
  (seed_uuid('cust:cleanright'),  'CleanRight Facilities Ltd',     'CRF001', 'Tony Siave',    'tony@cleanright.example.nz',       '07 555 0502', '4 Sunshine Ave',    'Hamilton',   'trade',    20, 800000,  true,  current_date - 250, current_date - 250, 'active', 'On stop until the August account settles.', 'UL-C002'),
  (seed_uuid('cust:raglanroast'), 'Raglan Roast Collective Ltd',   'RRC001', 'Mia Beaumont',  'mia@raglanroast.example.nz',       '07 555 0503', '18 Bow St',         'Raglan',     'standard', 20, 400000,  false, current_date - 400, current_date - 400, 'active', 'Legacy coffee price from the 2024 deal.', 'UL-C003'),
  (seed_uuid('cust:matamata'),    'Matamata Foodmarket Ltd',       'MFM001', 'Harpreet Gill', 'store@matamatafood.example.nz',    '07 555 0504', '77 Broadway',       'Matamata',   'trade',    20, 1000000, false, current_date - 350, current_date - 350, 'active', null, 'UL-C004'),
  (seed_uuid('cust:anchormotel'), 'Anchor Motel Group Ltd',        'AMG001', 'Brent Waaka',   'brent@anchormotels.example.nz',    '07 555 0505', '210 Ulster St',     'Hamilton',   'standard', 20, 600000,  false, current_date - 200, current_date - 200, 'active', null, 'UL-C005'),
  (seed_uuid('cust:terapaevent'), 'Te Rapa Event Centre Ltd',      'TEC001', 'Ana Fifita',    'ana@terapaevents.example.nz',      '07 555 0506', null,                'Hamilton',   'trade',    20, 900000,  false, current_date - 180, current_date - 180, 'active', 'Address never captured at onboarding.', 'UL-C006'),
  (seed_uuid('cust:fieldays'),    'Fieldays Catering Co Ltd',      'FCC001', 'Joe Parlane',   'joe@fieldayscatering.example.nz',  '07 555 0507', '3 Mystery Creek Rd','Hamilton',   'gold',     20, 700000,  false, current_date - 280, current_date - 280, 'active', 'Seasonal, but 62 days is long even for them.', 'UL-C007'),
  (seed_uuid('cust:hillcrest'),   'Hillcrest Superette Ltd',       'HSL001', 'Vinod Patel',   'vinod@hillcrestsuper.example.nz',  '07 555 0508', '2 Clyde St',        'Hamilton',   'standard', 20, 300000,  false, null,               null,               'active', 'Terms of trade never returned signed.', 'UL-C008'),
  (seed_uuid('cust:cambridge'),   'Cambridge Motor Lodge Ltd',     'CML001', 'Sue Third',     'sue@cambridgelodge.example.nz',    '07 555 0509', '55 Hamilton Rd',    'Cambridge',  'standard', 20, 500000,  false, current_date - 220, current_date - 220, 'active', null, 'UL-C009'),
  (seed_uuid('cust:kirikiriroa'), 'Kirikiriroa Childcare Trust',   'KCT001', 'Aroha Ngatai',  'admin@kirichildcare.example.nz',   '07 555 0510', '9 Peachgrove Rd',   'Hamilton',   'standard', 7,  null,    false, current_date - 100, null,               'active', 'Cash account, no credit.', 'UL-C010'),
  (seed_uuid('cust:baycatering'), 'Bay Catering Supplies Ltd',     'BCS001', 'Mark Rewi',     'mark@baycatering.example.nz',      '07 555 0511', '31 Totara St',      'Mount Maunganui', 'trade', 20, 600000, false, current_date - 320, current_date - 320, 'active', null, 'UL-C011'),
  (seed_uuid('cust:pukete'),      'Pukete Foodservice Ltd',        'PFS001', 'Grace Toala',   'grace@puketefood.example.nz',      '07 555 0512', '14 Church Rd',      'Hamilton',   'trade',    20, 750000,  false, current_date - 150, null,               'active', 'New credit account, PPSR never lodged.', 'UL-C012')
on conflict do nothing;

-- Products -------------------------------------------------------------------
-- The degreaser is class 8 with a declared storage ceiling of 60 drums: the
-- seed puts 84 on hand, exactly the position an HSWA walk-around finds.
-- The paper straws were listed but never priced: their order line books at $0.

insert into products (id, sku, name, category, unit, pack_size, cost_cents, price_cents, reorder_point, reorder_qty, supplier_id, hazardous, haz_class, haz_max_qty, active, note, external_ref) values
  (seed_uuid('prod:deg'),    'CHEM-DEG-20L', 'Heavy degreaser 20 L drum',            'chemicals',   'drum',   1,    6500, 10900, 20, 40,  seed_uuid('sup:chemsol'), true,  '8', 60,   true, null, 'UL-P001'),
  (seed_uuid('prod:ble'),    'CHEM-BLE-10L', 'Commercial bleach 10 L',               'chemicals',   'drum',   1,    2400, 4200,  24, 48,  seed_uuid('sup:chemsol'), true,  '8', 80,   true, null, 'UL-P002'),
  (seed_uuid('prod:san'),    'CHEM-SAN-5L',  'Food-safe sanitiser 5 L',              'chemicals',   'each',   1,    1800, 3300,  24, 48,  seed_uuid('sup:chemsol'), false, null, null, true, null, 'UL-P003'),
  (seed_uuid('prod:dish'),   'DET-DISH-5L',  'Dishwash liquid 5 L',                  'chemicals',   'each',   1,    1500, 2800,  24, 48,  seed_uuid('sup:chemsol'), false, null, null, true, null, 'UL-P004'),
  (seed_uuid('prod:ctn'),    'PACK-CTN-A3',  'Cardboard cartons A3, bundle of 25',   'packaging',   'bundle', 25,   1400, 2600,  40, 100, seed_uuid('sup:pacific'), false, null, null, true, null, 'UL-P005'),
  (seed_uuid('prod:wrap'),   'PACK-WRAP',    'Pallet wrap 500 mm roll',              'packaging',   'roll',   1,    3800, 6200,  10, 20,  seed_uuid('sup:pacific'), false, null, null, true, null, 'UL-P006'),
  (seed_uuid('prod:towel'),  'PAPER-TOWEL',  'Paper towel carton, 20 rolls',         'paper',       'carton', 20,   2200, 3900,  40, 80,  seed_uuid('sup:kiwipap'), false, null, null, true, null, 'UL-P007'),
  (seed_uuid('prod:tissue'), 'TISSUE-2PLY',  'Toilet tissue 2-ply carton, 48 rolls', 'paper',       'carton', 48,   1900, 3400,  30, 60,  seed_uuid('sup:kiwipap'), false, null, null, true, null, 'UL-P008'),
  (seed_uuid('prod:cup8'),   'CUPS-8OZ',     'Takeaway cups 8 oz carton, 1000',      'hospitality', 'carton', 1000, 4800, 7900,  30, 60,  seed_uuid('sup:pacific'), false, null, null, true, null, 'UL-P009'),
  (seed_uuid('prod:cup12'),  'CUPS-12OZ',    'Takeaway cups 12 oz carton, 1000',     'hospitality', 'carton', 1000, 5200, 8400,  20, 40,  seed_uuid('sup:pacific'), false, null, null, true, null, 'UL-P010'),
  (seed_uuid('prod:glove'),  'GLOVE-NIT-L',  'Nitrile gloves large, box of 100',     'hospitality', 'box',    100,  950,  1800,  50, 100, seed_uuid('sup:pacific'), false, null, null, true, null, 'UL-P011'),
  (seed_uuid('prod:bin'),    'BIN-240L',     'Bin liners 240 L carton, 100',         'packaging',   'carton', 100,  2600, 4400,  0,  0,   seed_uuid('sup:pacific'), false, null, null, true, 'Bought for a contract that ended.', 'UL-P012'),
  (seed_uuid('prod:foil'),   'FOIL-CATER',   'Catering foil 440 mm roll',            'hospitality', 'roll',   1,    3100, 5300,  10, 20,  seed_uuid('sup:pacific'), false, null, null, true, null, 'UL-P013'),
  (seed_uuid('prod:coffee'), 'COFFEE-1KG',   'Espresso blend beans 1 kg',            'beverage',    'each',   1,    2900, 4400,  20, 40,  seed_uuid('sup:aotea'),   false, null, null, true, 'Cost went up in July; the Raglan price never did.', 'UL-P014'),
  (seed_uuid('prod:straw'),  'STRAW-PAPER',  'Paper straws carton, 2500',            'hospitality', 'carton', 2500, 2000, 0,     0,  0,   seed_uuid('sup:pacific'), false, null, null, true, 'New line, never priced.', 'UL-P015'),
  (seed_uuid('prod:sugar'),  'SUGAR-STICK',  'Sugar sticks carton, 2000',            'beverage',    'carton', 2000, 1700, 3000,  20, 40,  seed_uuid('sup:aotea'),   false, null, null, true, null, 'UL-P016')
on conflict do nothing;

-- Prices -------------------------------------------------------------------
-- Two gold tier prices and one legacy customer price that sits below cost.

insert into prices (id, product_id, customer_id, tier, price_cents, effective_on, note, external_ref) values
  (seed_uuid('price:gold-towel'),  seed_uuid('prod:towel'),  null, 'gold', 3500, current_date - 200, null, 'UL-PR01'),
  (seed_uuid('price:gold-deg'),    seed_uuid('prod:deg'),    null, 'gold', 9900, current_date - 200, null, 'UL-PR02'),
  (seed_uuid('price:raglan-coffee'), seed_uuid('prod:coffee'), seed_uuid('cust:raglanroast'), null, 2600, current_date - 420, 'The 2024 launch deal. Cost has moved since.', 'UL-PR03')
on conflict do nothing;

-- Sales orders -------------------------------------------------------------------
-- Shipped and invoiced history first (the margin record), then the live mess.

insert into sales_orders (id, so_no, customer_id, customer_ref, warehouse_id, status, ordered_on, required_by, shipped_at, note, external_ref) values
  (seed_uuid('so:5081'), 'SO-5081', seed_uuid('cust:waikatohosp'), 'WHG-2201', seed_uuid('wh:ham'), 'shipped', current_date - 30, current_date - 28, current_date - 29 + time '10:30', null, 'UL-5081'),
  (seed_uuid('so:5083'), 'SO-5083', seed_uuid('cust:matamata'),    'MFM-118',  seed_uuid('wh:ham'), 'shipped', current_date - 25, current_date - 23, current_date - 24 + time '09:15', null, 'UL-5083'),
  (seed_uuid('so:5085'), 'SO-5085', seed_uuid('cust:fieldays'),    'FCC-88',   seed_uuid('wh:ham'), 'shipped', current_date - 62, current_date - 60, current_date - 61 + time '11:00', null, 'UL-5085'),
  (seed_uuid('so:5088'), 'SO-5088', seed_uuid('cust:raglanroast'), 'RRC-301',  seed_uuid('wh:ham'), 'shipped', current_date - 20, current_date - 18, current_date - 19 + time '14:20', null, 'UL-5088'),
  (seed_uuid('so:5090'), 'SO-5090', seed_uuid('cust:terapaevent'), 'TEC-77',   seed_uuid('wh:ham'), 'shipped', current_date - 15, current_date - 13, current_date - 14 + time '08:45', null, 'UL-5090'),
  (seed_uuid('so:5092'), 'SO-5092', seed_uuid('cust:baycatering'), 'BCS-412',  seed_uuid('wh:ham'), 'shipped', current_date - 10, current_date - 8,  current_date - 9 + time '13:05',  null, 'UL-5092'),
  (seed_uuid('so:5094'), 'SO-5094', seed_uuid('cust:anchormotel'), 'AMG-19',   seed_uuid('wh:ham'), 'shipped', current_date - 6,  current_date - 4,  current_date - 5 + time '10:10',  null, 'UL-5094'),
  (seed_uuid('so:5095'), 'SO-5095', seed_uuid('cust:waikatohosp'), 'WHG-2237', seed_uuid('wh:ham'), 'shipped', current_date - 4,  current_date - 2,  current_date - 3 + time '09:40',  null, 'UL-5095'),
  (seed_uuid('so:5100'), 'SO-5100', seed_uuid('cust:hillcrest'),   'HSL-56',   seed_uuid('wh:ham'), 'open',    current_date - 3,  current_date + 1,  null, null, 'UL-5100'),
  (seed_uuid('so:5101'), 'SO-5101', seed_uuid('cust:cambridge'),   'CML-240',  seed_uuid('wh:ham'), 'open',    current_date - 5,  current_date - 2,  null, 'Sue rang twice about this one.', 'UL-5101'),
  (seed_uuid('so:5102'), 'SO-5102', seed_uuid('cust:matamata'),    'MFM-131',  seed_uuid('wh:ham'), 'part',    current_date - 2,  current_date + 2,  null, null, 'UL-5102'),
  (seed_uuid('so:5103'), 'SO-5103', seed_uuid('cust:terapaevent'), 'TEC-81',   seed_uuid('wh:ham'), 'open',    current_date - 1,  current_date + 3,  null, null, 'UL-5103'),
  (seed_uuid('so:5104'), 'SO-5104', seed_uuid('cust:raglanroast'), 'RRC-318',  seed_uuid('wh:ham'), 'open',    current_date,      current_date + 4,  null, null, 'UL-5104'),
  (seed_uuid('so:5105'), 'SO-5105', seed_uuid('cust:cleanright'),  'CRF-902',  seed_uuid('wh:ham'), 'on-hold', current_date - 8,  current_date - 4,  null, 'Held with the account. Tony knows.', 'UL-5105')
on conflict do nothing;

insert into so_lines (id, so_id, product_id, qty, qty_shipped, qty_invoiced, price_cents, price_desc, cost_cents, last_shipped_at) values
  -- SO-5081 Waikato Hospitality, shipped 29 days ago, on the period invoice
  (seed_uuid('sol:5081-1'), seed_uuid('so:5081'), seed_uuid('prod:towel'), 30, 30, 30, 3500, 'Gold tier',  2200, current_date - 29 + time '10:30'),
  (seed_uuid('sol:5081-2'), seed_uuid('so:5081'), seed_uuid('prod:ble'),   12, 12, 12, 4200, 'List',       2400, current_date - 29 + time '10:30'),
  (seed_uuid('sol:5081-3'), seed_uuid('so:5081'), seed_uuid('prod:ctn'),   20, 20, 20, 2600, 'List',       1400, current_date - 29 + time '10:30'),
  -- SO-5083 Matamata, shipped and invoiced (INV-3111, paid)
  (seed_uuid('sol:5083-1'), seed_uuid('so:5083'), seed_uuid('prod:ctn'),   18, 18, 18, 2600, 'List',       1400, current_date - 24 + time '09:15'),
  (seed_uuid('sol:5083-2'), seed_uuid('so:5083'), seed_uuid('prod:cup8'),  16, 16, 16, 7900, 'List',       4800, current_date - 24 + time '09:15'),
  -- SO-5085 Fieldays, 62 days ago: their last order
  (seed_uuid('sol:5085-1'), seed_uuid('so:5085'), seed_uuid('prod:foil'),  10, 10, 10, 5300, 'List',       3100, current_date - 61 + time '11:00'),
  (seed_uuid('sol:5085-2'), seed_uuid('so:5085'), seed_uuid('prod:sugar'), 12, 12, 12, 3000, 'List',       1700, current_date - 61 + time '11:00'),
  -- SO-5088 Raglan Roast, the legacy coffee price (was above cost then)
  (seed_uuid('sol:5088-1'), seed_uuid('so:5088'), seed_uuid('prod:coffee'), 15, 15, 15, 2600, 'Customer price', 2900, current_date - 19 + time '14:20'),
  -- SO-5090 Te Rapa Event Centre: the dish line was keyed at $31.00 against a $28.00 list
  (seed_uuid('sol:5090-1'), seed_uuid('so:5090'), seed_uuid('prod:dish'),  15, 15, 15, 3100, 'Manual',     1500, current_date - 14 + time '08:45'),
  (seed_uuid('sol:5090-2'), seed_uuid('so:5090'), seed_uuid('prod:wrap'),  5,  5,  5,  6200, 'List',       3800, current_date - 14 + time '08:45'),
  (seed_uuid('sol:5090-3'), seed_uuid('so:5090'), seed_uuid('prod:glove'), 15, 15, 15, 1800, 'List',       950,  current_date - 14 + time '08:45'),
  -- SO-5092 Bay Catering, shipped; its invoice was drafted and never sent
  (seed_uuid('sol:5092-1'), seed_uuid('so:5092'), seed_uuid('prod:san'),   12, 12, 12, 3300, 'List',       1800, current_date - 9 + time '13:05'),
  (seed_uuid('sol:5092-2'), seed_uuid('so:5092'), seed_uuid('prod:ble'),   6,  6,  6,  4200, 'List',       2400, current_date - 9 + time '13:05'),
  -- SO-5094 Anchor Motel: shipped 5 days ago, never billed
  (seed_uuid('sol:5094-1'), seed_uuid('so:5094'), seed_uuid('prod:towel'), 10, 10, 0,  3900, 'List',       2200, current_date - 5 + time '10:10'),
  (seed_uuid('sol:5094-2'), seed_uuid('so:5094'), seed_uuid('prod:glove'), 20, 20, 0,  1800, 'List',       950,  current_date - 5 + time '10:10'),
  -- SO-5095 Waikato Hospitality: shipped 3 days ago, never billed, tips them over the limit
  (seed_uuid('sol:5095-1'), seed_uuid('so:5095'), seed_uuid('prod:deg'),   6,  6,  0,  9900, 'Gold tier',  6500, current_date - 3 + time '09:40'),
  (seed_uuid('sol:5095-2'), seed_uuid('so:5095'), seed_uuid('prod:towel'), 20, 20, 0,  3500, 'Gold tier',  2200, current_date - 3 + time '09:40'),
  -- SO-5100 Hillcrest: entered 3 days ago, nothing shipped
  (seed_uuid('sol:5100-1'), seed_uuid('so:5100'), seed_uuid('prod:cup12'), 6,  0,  0,  8400, 'List',       5200, null),
  (seed_uuid('sol:5100-2'), seed_uuid('so:5100'), seed_uuid('prod:sugar'), 10, 0,  0,  3000, 'List',       1700, null),
  -- SO-5101 Cambridge: required two days ago, nothing shipped
  (seed_uuid('sol:5101-1'), seed_uuid('so:5101'), seed_uuid('prod:tissue'), 12, 0, 0,  3400, 'List',       1900, null),
  (seed_uuid('sol:5101-2'), seed_uuid('so:5101'), seed_uuid('prod:dish'),  8,  0,  0,  2800, 'List',       1500, null),
  -- SO-5102 Matamata: 64 cartons of 8 oz cups wanted, 40 shipped, 24 backordered
  (seed_uuid('sol:5102-1'), seed_uuid('so:5102'), seed_uuid('prod:cup8'),  64, 40, 0,  7900, 'List',       4800, current_date - 1 + time '09:00'),
  -- SO-5103 Te Rapa: 30 carton bundles against 12 on hand, and an unpriced straw line
  (seed_uuid('sol:5103-1'), seed_uuid('so:5103'), seed_uuid('prod:ctn'),   30, 0,  0,  2600, 'List',       1400, null),
  (seed_uuid('sol:5103-2'), seed_uuid('so:5103'), seed_uuid('prod:straw'), 8,  0,  0,  0,    null,         2000, null),
  -- SO-5104 Raglan Roast: the legacy price is now below cost
  (seed_uuid('sol:5104-1'), seed_uuid('so:5104'), seed_uuid('prod:coffee'), 20, 0, 0,  2600, 'Customer price', 2900, null),
  -- SO-5105 CleanRight: held with the stopped account
  (seed_uuid('sol:5105-1'), seed_uuid('so:5105'), seed_uuid('prod:towel'), 24, 0,  0,  3900, 'List',       2200, null),
  (seed_uuid('sol:5105-2'), seed_uuid('so:5105'), seed_uuid('prod:dish'),  10, 0,  0,  2800, 'List',       1500, null)
on conflict do nothing;

-- Purchase orders -------------------------------------------------------------------
-- PO-7418 is 3 days past its expected date. PO-7420 covers the cup backorder
-- in 4 days. Nothing covers the carton backorder: that is the point.

insert into purchase_orders (id, po_no, supplier_id, warehouse_id, status, ordered_on, expected_on, note, external_ref) values
  (seed_uuid('po:7415'), 'PO-7415', seed_uuid('sup:kiwipap'), seed_uuid('wh:ham'), 'received', current_date - 20, current_date - 14, null, 'UL-7415'),
  (seed_uuid('po:7418'), 'PO-7418', seed_uuid('sup:chemsol'), seed_uuid('wh:ham'), 'open',     current_date - 10, current_date - 3,  'Priya said the bleach was on the Friday truck. It was not.', 'UL-7418'),
  (seed_uuid('po:7420'), 'PO-7420', seed_uuid('sup:pacific'), seed_uuid('wh:ham'), 'open',     current_date - 5,  current_date + 4,  null, 'UL-7420')
on conflict do nothing;

insert into po_lines (id, po_id, product_id, qty, qty_received, cost_cents) values
  (seed_uuid('pol:7415-1'), seed_uuid('po:7415'), seed_uuid('prod:towel'),  80, 80, 2150),
  (seed_uuid('pol:7415-2'), seed_uuid('po:7415'), seed_uuid('prod:tissue'), 60, 60, 1850),
  (seed_uuid('pol:7418-1'), seed_uuid('po:7418'), seed_uuid('prod:ble'),    40, 0,  2400),
  (seed_uuid('pol:7418-2'), seed_uuid('po:7418'), seed_uuid('prod:san'),    30, 0,  1750),
  (seed_uuid('pol:7420-1'), seed_uuid('po:7420'), seed_uuid('prod:cup8'),   60, 0,  4700),
  (seed_uuid('pol:7420-2'), seed_uuid('po:7420'), seed_uuid('prod:wrap'),   20, 0,  3700)
on conflict do nothing;

-- Stock ledger -------------------------------------------------------------------
-- Opening balances, the received PO, every shipment, and two adjustments:
-- one honest (a stocktake, with its reason) and one with no reason at all.

insert into stock_moves (id, product_id, warehouse_id, qty, kind, so_line_id, po_line_id, reason, moved_at, external_ref) values
  -- Opening balances
  (seed_uuid('mv:open-deg'),    seed_uuid('prod:deg'),    seed_uuid('wh:ham'), 90,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M001'),
  (seed_uuid('mv:open-ble'),    seed_uuid('prod:ble'),    seed_uuid('wh:ham'), 64,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M002'),
  (seed_uuid('mv:open-san'),    seed_uuid('prod:san'),    seed_uuid('wh:ham'), 72,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M003'),
  (seed_uuid('mv:open-dish'),   seed_uuid('prod:dish'),   seed_uuid('wh:ham'), 87,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M004'),
  (seed_uuid('mv:open-ctn'),    seed_uuid('prod:ctn'),    seed_uuid('wh:ham'), 50,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M005'),
  (seed_uuid('mv:open-wrap'),   seed_uuid('prod:wrap'),   seed_uuid('wh:ham'), 33,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M006'),
  (seed_uuid('mv:open-towel'),  seed_uuid('prod:towel'),  seed_uuid('wh:ham'), 120, 'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M007'),
  (seed_uuid('mv:open-toweltga'), seed_uuid('prod:towel'), seed_uuid('wh:tga'), 40, 'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M008'),
  (seed_uuid('mv:open-tissue'), seed_uuid('prod:tissue'), seed_uuid('wh:ham'), 30,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M009'),
  (seed_uuid('mv:open-cup8'),   seed_uuid('prod:cup8'),   seed_uuid('wh:ham'), 60,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M010'),
  (seed_uuid('mv:open-cup12'),  seed_uuid('prod:cup12'),  seed_uuid('wh:ham'), 38,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M011'),
  (seed_uuid('mv:open-glove'),  seed_uuid('prod:glove'),  seed_uuid('wh:ham'), 79,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M012'),
  (seed_uuid('mv:open-bin'),    seed_uuid('prod:bin'),    seed_uuid('wh:ham'), 64,  'receipt', null, null, 'Opening balance', current_date - 120, 'UL-M013'),
  (seed_uuid('mv:open-foil'),   seed_uuid('prod:foil'),   seed_uuid('wh:ham'), 40,  'receipt', null, null, 'Opening balance', current_date - 70, 'UL-M014'),
  (seed_uuid('mv:open-coffee'), seed_uuid('prod:coffee'), seed_uuid('wh:ham'), 70,  'receipt', null, null, 'Opening balance', current_date - 45, 'UL-M015'),
  (seed_uuid('mv:open-straw'),  seed_uuid('prod:straw'),  seed_uuid('wh:ham'), 30,  'receipt', null, null, 'Opening balance', current_date - 30, 'UL-M016'),
  (seed_uuid('mv:open-sugar'),  seed_uuid('prod:sugar'),  seed_uuid('wh:ham'), 58,  'receipt', null, null, 'Opening balance', current_date - 70, 'UL-M017'),
  -- PO-7415 received 13 days ago
  (seed_uuid('mv:po7415-towel'),  seed_uuid('prod:towel'),  seed_uuid('wh:ham'), 80, 'receipt', null, seed_uuid('pol:7415-1'), 'PO-7415 received', current_date - 13, 'UL-M020'),
  (seed_uuid('mv:po7415-tissue'), seed_uuid('prod:tissue'), seed_uuid('wh:ham'), 60, 'receipt', null, seed_uuid('pol:7415-2'), 'PO-7415 received', current_date - 13, 'UL-M021'),
  -- Shipments
  (seed_uuid('mv:5081-towel'), seed_uuid('prod:towel'),  seed_uuid('wh:ham'), -30, 'shipment', seed_uuid('sol:5081-1'), null, 'SO-5081', current_date - 29 + time '10:30', 'UL-M030'),
  (seed_uuid('mv:5081-ble'),   seed_uuid('prod:ble'),    seed_uuid('wh:ham'), -12, 'shipment', seed_uuid('sol:5081-2'), null, 'SO-5081', current_date - 29 + time '10:30', 'UL-M031'),
  (seed_uuid('mv:5081-ctn'),   seed_uuid('prod:ctn'),    seed_uuid('wh:ham'), -20, 'shipment', seed_uuid('sol:5081-3'), null, 'SO-5081', current_date - 29 + time '10:30', 'UL-M032'),
  (seed_uuid('mv:5083-ctn'),   seed_uuid('prod:ctn'),    seed_uuid('wh:ham'), -18, 'shipment', seed_uuid('sol:5083-1'), null, 'SO-5083', current_date - 24 + time '09:15', 'UL-M033'),
  (seed_uuid('mv:5083-cup8'),  seed_uuid('prod:cup8'),   seed_uuid('wh:ham'), -16, 'shipment', seed_uuid('sol:5083-2'), null, 'SO-5083', current_date - 24 + time '09:15', 'UL-M034'),
  (seed_uuid('mv:5085-foil'),  seed_uuid('prod:foil'),   seed_uuid('wh:ham'), -10, 'shipment', seed_uuid('sol:5085-1'), null, 'SO-5085', current_date - 61 + time '11:00', 'UL-M035'),
  (seed_uuid('mv:5085-sugar'), seed_uuid('prod:sugar'),  seed_uuid('wh:ham'), -12, 'shipment', seed_uuid('sol:5085-2'), null, 'SO-5085', current_date - 61 + time '11:00', 'UL-M036'),
  (seed_uuid('mv:5088-coffee'), seed_uuid('prod:coffee'), seed_uuid('wh:ham'), -15, 'shipment', seed_uuid('sol:5088-1'), null, 'SO-5088', current_date - 19 + time '14:20', 'UL-M037'),
  (seed_uuid('mv:5090-dish'),  seed_uuid('prod:dish'),   seed_uuid('wh:ham'), -15, 'shipment', seed_uuid('sol:5090-1'), null, 'SO-5090', current_date - 14 + time '08:45', 'UL-M038'),
  (seed_uuid('mv:5090-wrap'),  seed_uuid('prod:wrap'),   seed_uuid('wh:ham'), -5,  'shipment', seed_uuid('sol:5090-2'), null, 'SO-5090', current_date - 14 + time '08:45', 'UL-M039'),
  (seed_uuid('mv:5090-glove'), seed_uuid('prod:glove'),  seed_uuid('wh:ham'), -15, 'shipment', seed_uuid('sol:5090-3'), null, 'SO-5090', current_date - 14 + time '08:45', 'UL-M040'),
  (seed_uuid('mv:5092-san'),   seed_uuid('prod:san'),    seed_uuid('wh:ham'), -12, 'shipment', seed_uuid('sol:5092-1'), null, 'SO-5092', current_date - 9 + time '13:05', 'UL-M041'),
  (seed_uuid('mv:5092-ble'),   seed_uuid('prod:ble'),    seed_uuid('wh:ham'), -6,  'shipment', seed_uuid('sol:5092-2'), null, 'SO-5092', current_date - 9 + time '13:05', 'UL-M042'),
  (seed_uuid('mv:5094-towel'), seed_uuid('prod:towel'),  seed_uuid('wh:ham'), -10, 'shipment', seed_uuid('sol:5094-1'), null, 'SO-5094', current_date - 5 + time '10:10', 'UL-M043'),
  (seed_uuid('mv:5094-glove'), seed_uuid('prod:glove'),  seed_uuid('wh:ham'), -20, 'shipment', seed_uuid('sol:5094-2'), null, 'SO-5094', current_date - 5 + time '10:10', 'UL-M044'),
  (seed_uuid('mv:5095-deg'),   seed_uuid('prod:deg'),    seed_uuid('wh:ham'), -6,  'shipment', seed_uuid('sol:5095-1'), null, 'SO-5095', current_date - 3 + time '09:40', 'UL-M045'),
  (seed_uuid('mv:5095-towel'), seed_uuid('prod:towel'),  seed_uuid('wh:ham'), -20, 'shipment', seed_uuid('sol:5095-2'), null, 'SO-5095', current_date - 3 + time '09:40', 'UL-M046'),
  (seed_uuid('mv:5102-cup8'),  seed_uuid('prod:cup8'),   seed_uuid('wh:ham'), -40, 'shipment', seed_uuid('sol:5102-1'), null, 'SO-5102', current_date - 1 + time '09:00', 'UL-M047'),
  -- Adjustments: one explained, one not
  (seed_uuid('mv:adj-sugar'),  seed_uuid('prod:sugar'),  seed_uuid('wh:ham'), 2,   'adjustment', null, null, 'Stocktake count correction, August', current_date - 40, 'UL-M050'),
  (seed_uuid('mv:adj-foil'),   seed_uuid('prod:foil'),   seed_uuid('wh:ham'), -4,  'adjustment', null, null, null, current_date - 5, 'UL-M051')
on conflict do nothing;

-- Invoices -------------------------------------------------------------------
-- INV-3110 is 30 days overdue on the over-limit account. INV-3114 is a draft
-- that never went out. GST is 15%, on its own line, every time.

insert into invoices (id, number, customer_id, issued_on, due_on, status, total_cents, external_ref) values
  (seed_uuid('inv:3106'), 'INV-3106', seed_uuid('cust:fieldays'),    current_date - 60, current_date - 40, 'paid',  102350,  'UL-I3106'),
  (seed_uuid('inv:3108'), 'INV-3108', seed_uuid('cust:raglanroast'), current_date - 18, current_date + 2,  'paid',  44850,   'UL-I3108'),
  (seed_uuid('inv:3110'), 'INV-3110', seed_uuid('cust:waikatohosp'), current_date - 50, current_date - 30, 'sent',  1380000, 'UL-I3110'),
  (seed_uuid('inv:3111'), 'INV-3111', seed_uuid('cust:matamata'),    current_date - 24, current_date - 4,  'paid',  199180,  'UL-I3111'),
  (seed_uuid('inv:3113'), 'INV-3113', seed_uuid('cust:terapaevent'), current_date - 14, current_date + 6,  'sent',  120175,  'UL-I3113'),
  (seed_uuid('inv:3114'), 'INV-3114', seed_uuid('cust:baycatering'), current_date - 6,  current_date + 14, 'draft', 74520,   'UL-I3114')
on conflict do nothing;

insert into invoice_lines (id, invoice_id, so_line_id, description, qty, amount_cents) values
  (seed_uuid('il:3106-1'), seed_uuid('inv:3106'), seed_uuid('sol:5085-1'), 'FOIL-CATER x 10 on SO-5085', 10, 53000),
  (seed_uuid('il:3106-2'), seed_uuid('inv:3106'), seed_uuid('sol:5085-2'), 'SUGAR-STICK x 12 on SO-5085', 12, 36000),
  (seed_uuid('il:3106-3'), seed_uuid('inv:3106'), null, 'GST 15%', null, 13350),
  (seed_uuid('il:3108-1'), seed_uuid('inv:3108'), seed_uuid('sol:5088-1'), 'COFFEE-1KG x 15 on SO-5088', 15, 39000),
  (seed_uuid('il:3108-2'), seed_uuid('inv:3108'), null, 'GST 15%', null, 5850),
  (seed_uuid('il:3110-1'), seed_uuid('inv:3110'), null, 'Goods for the period: 11 orders including SO-5081', null, 1200000),
  (seed_uuid('il:3110-2'), seed_uuid('inv:3110'), null, 'GST 15%', null, 180000),
  (seed_uuid('il:3111-1'), seed_uuid('inv:3111'), seed_uuid('sol:5083-1'), 'PACK-CTN-A3 x 18 on SO-5083', 18, 46800),
  (seed_uuid('il:3111-2'), seed_uuid('inv:3111'), seed_uuid('sol:5083-2'), 'CUPS-8OZ x 16 on SO-5083', 16, 126400),
  (seed_uuid('il:3111-3'), seed_uuid('inv:3111'), null, 'GST 15%', null, 25980),
  (seed_uuid('il:3113-1'), seed_uuid('inv:3113'), seed_uuid('sol:5090-1'), 'DET-DISH-5L x 15 on SO-5090', 15, 46500),
  (seed_uuid('il:3113-2'), seed_uuid('inv:3113'), seed_uuid('sol:5090-2'), 'PACK-WRAP x 5 on SO-5090', 5, 31000),
  (seed_uuid('il:3113-3'), seed_uuid('inv:3113'), seed_uuid('sol:5090-3'), 'GLOVE-NIT-L x 15 on SO-5090', 15, 27000),
  (seed_uuid('il:3113-4'), seed_uuid('inv:3113'), null, 'GST 15%', null, 15675),
  (seed_uuid('il:3114-1'), seed_uuid('inv:3114'), seed_uuid('sol:5092-1'), 'CHEM-SAN-5L x 12 on SO-5092', 12, 39600),
  (seed_uuid('il:3114-2'), seed_uuid('inv:3114'), seed_uuid('sol:5092-2'), 'CHEM-BLE-10L x 6 on SO-5092', 6, 25200),
  (seed_uuid('il:3114-3'), seed_uuid('inv:3114'), null, 'GST 15%', null, 9720)
on conflict do nothing;

-- Notes and tasks -------------------------------------------------------------------

insert into notes (id, customer_id, so_id, body, created_at) values
  (seed_uuid('note:1'), seed_uuid('cust:waikatohosp'), null, 'Louise called about INV-3110: payment run is "next Friday". Second Friday so far.', now() - interval '7 days'),
  (seed_uuid('note:2'), seed_uuid('cust:terapaevent'), seed_uuid('so:5103'), 'Ana needs the cartons before the weekend event. Told her 12 now, the rest when Pacific lands. No PO behind the rest yet.', now() - interval '1 day'),
  (seed_uuid('note:3'), seed_uuid('cust:raglanroast'), null, 'Mia asked to double the coffee standing order. The 2024 price is below our cost now: review before agreeing.', now() - interval '2 days')
on conflict do nothing;

insert into tasks (id, title, customer_id, due_on, status) values
  (seed_uuid('task:1'), 'Chase the Waikato Hospitality account before month end', seed_uuid('cust:waikatohosp'), current_date - 3, 'open'),
  (seed_uuid('task:2'), 'Run the Tauriko depot stocktake', null, current_date + 5, 'open')
on conflict do nothing;
