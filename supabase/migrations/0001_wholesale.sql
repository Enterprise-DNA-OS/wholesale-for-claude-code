-- wholesale-for-claude-code: core schema.
-- A wholesale distributor: the products with their costs, prices and reorder
-- points, the stock in each warehouse as an auditable movement ledger, the
-- customers with their price tiers and credit terms, the sales orders from
-- entry to shipment (with backorders recorded honestly), the purchase orders
-- that replenish, and the invoice run that bills what actually shipped.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is in cents. Stock on hand is never a column: it is the sum of
-- stock_moves, so every unit on the shelf has a movement that explains it
-- (receipt, shipment, adjustment, count). Prices are stamped onto the order
-- line at entry, off the price rule that matched, and the match is recorded
-- (price_desc), so a price change never reprices entered orders. The board,
-- the backorders, the reorder run and the attention list all read the same
-- views, so they can never disagree with each other.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Customers ------------------------------------------------------------------
-- price_tier picks the tier price when no customer-specific price exists.
-- terms_signed_on and ppsr_registered_on are the compliance dates: written
-- terms of trade, and the PPSR financing statement that makes a retention of
-- title clause survive a liquidation. on_stop is the credit hold: the CLI
-- refuses new orders for a stopped account.

create table if not exists customers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  code               text,
  contact_name       text,
  email              text,
  phone              text,
  address            text,
  city               text,
  price_tier         text not null default 'standard',  -- standard | trade | gold
  terms_days         integer not null default 20,
  credit_limit_cents bigint,
  on_stop            boolean not null default false,
  terms_signed_on    date,
  ppsr_registered_on date,
  status             text not null default 'active',  -- active | former
  note               text,
  external_ref       text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists customers_name_lower_idx on customers (lower(name));

-- Suppliers ------------------------------------------------------------------

create table if not exists suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  code           text,
  contact_name   text,
  email          text,
  phone          text,
  city           text,
  lead_time_days integer not null default 7,
  active         boolean not null default true,
  note           text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists suppliers_name_lower_idx on suppliers (lower(name));

-- Warehouses ------------------------------------------------------------------

create table if not exists warehouses (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  name       text,
  city       text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists warehouses_code_lower_idx on warehouses (lower(code));

-- Products ------------------------------------------------------------------
-- cost_cents is the current buy cost (stamped onto order lines for margin,
-- and onto PO lines at ordering). price_cents is the base list price; tier
-- and customer prices in the prices table beat it. hazardous products carry
-- the declared storage ceiling (haz_max_qty) that the HSWA hazardous
-- substances check reads.

create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null,
  name          text not null,
  category      text,
  unit          text not null default 'each',   -- each | carton | drum | box | roll
  pack_size     integer,
  cost_cents    bigint not null default 0,
  price_cents   bigint not null default 0,       -- base list; 0 means never priced
  reorder_point numeric not null default 0,
  reorder_qty   numeric not null default 0,
  supplier_id   uuid references suppliers (id),
  hazardous     boolean not null default false,
  haz_class     text,
  haz_max_qty   numeric,                         -- declared storage ceiling, in units
  active        boolean not null default true,
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists products_sku_lower_idx on products (lower(sku));

-- Prices ------------------------------------------------------------------
-- Price resolution at order entry: the customer's own row wins, then the
-- customer's tier row, then the product's base price. The winning rule and
-- price are stamped onto the line (price_cents, price_desc) and never
-- silently recomputed.

create table if not exists prices (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products (id),
  customer_id  uuid references customers (id),   -- set: a customer-specific price
  tier         text,                             -- set: a tier price (customer_id null)
  price_cents  bigint not null,
  effective_on date not null default now()::date,
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists prices_rule_idx
  on prices (product_id, coalesce(customer_id::text, ''), coalesce(tier, ''));

-- Sales orders ------------------------------------------------------------------
-- The unit of the selling side. Lines are priced at entry; `ship` moves what
-- stock allows and records the shortfall as backorder (qty - qty_shipped);
-- `bill` invoices what shipped (qty_shipped - qty_invoiced), never more.

create table if not exists sales_orders (
  id           uuid primary key default gen_random_uuid(),
  so_no        text not null,
  customer_id  uuid not null references customers (id),
  customer_ref text,
  warehouse_id uuid references warehouses (id),
  status       text not null default 'open',  -- open | part | shipped | on-hold | cancelled
  ordered_on   date not null default now()::date,
  required_by  date,
  shipped_at   timestamptz,                   -- set when fully shipped
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists sales_orders_no_lower_idx on sales_orders (lower(so_no));
create index if not exists sales_orders_customer_idx on sales_orders (customer_id);

create table if not exists so_lines (
  id              uuid primary key default gen_random_uuid(),
  so_id           uuid not null references sales_orders (id),
  product_id      uuid not null references products (id),
  qty             numeric not null,
  qty_shipped     numeric not null default 0,
  qty_invoiced    numeric not null default 0,
  price_cents     bigint not null default 0,
  price_desc      text,                        -- how it was priced; null means no price matched
  cost_cents      bigint not null default 0,   -- cost snapshot at entry, for margin
  last_shipped_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists so_lines_so_idx on so_lines (so_id);
create index if not exists so_lines_product_idx on so_lines (product_id);

-- Purchase orders ------------------------------------------------------------------

create table if not exists purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  po_no        text not null,
  supplier_id  uuid not null references suppliers (id),
  warehouse_id uuid references warehouses (id),
  status       text not null default 'open',  -- open | part | received | cancelled
  ordered_on   date not null default now()::date,
  expected_on  date,
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists purchase_orders_no_lower_idx on purchase_orders (lower(po_no));

create table if not exists po_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders (id),
  product_id   uuid not null references products (id),
  qty          numeric not null,
  qty_received numeric not null default 0,
  cost_cents   bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists po_lines_po_idx on po_lines (po_id);
create index if not exists po_lines_product_idx on po_lines (product_id);

-- Stock moves ------------------------------------------------------------------
-- The ledger. On hand is sum(qty) and nothing else, so every unit is
-- explained. Adjustments demand a reason: the Companies Act wants records
-- that explain the transactions, and so does anyone counting shrinkage.

create table if not exists stock_moves (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products (id),
  warehouse_id uuid not null references warehouses (id),
  qty          numeric not null,                -- positive in, negative out
  kind         text not null,                   -- receipt | shipment | adjustment | count
  so_line_id   uuid references so_lines (id),
  po_line_id   uuid references po_lines (id),
  reason       text,
  moved_at     timestamptz not null default now(),
  external_ref text unique,
  created_at   timestamptz not null default now()
);
create index if not exists stock_moves_product_idx on stock_moves (product_id, warehouse_id);
create index if not exists stock_moves_kind_idx on stock_moves (kind);

-- Invoices ------------------------------------------------------------------
-- Drafted by the billing run from shipped-uninvoiced quantities, GST on its
-- own line. Sent and reconciled by a person in the accounting system;
-- nothing here sends anything.

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  number       text not null,
  customer_id  uuid not null references customers (id),
  issued_on    date not null default now()::date,
  due_on       date,
  status       text not null default 'draft',  -- draft | sent | paid
  total_cents  bigint not null default 0,
  note         text,
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists invoices_number_lower_idx on invoices (lower(number));

create table if not exists invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices (id),
  so_line_id   uuid references so_lines (id),
  description  text not null,
  qty          numeric,
  amount_cents bigint not null,
  created_at   timestamptz not null default now()
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- Notes and tasks ------------------------------------------------------------------

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers (id),
  so_id       uuid references sales_orders (id),
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  customer_id uuid references customers (id),
  due_on      date,
  status      text not null default 'open',  -- open | done
  done_on     date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at triggers ---------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['customers','suppliers','products','prices','sales_orders','so_lines','purchase_orders','po_lines','invoices','tasks'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end
$$;

-- Views -----------------------------------------------------------------------
-- Everything that talks about the same stock or the same money reads the
-- same view, so two commands can never disagree.

-- On hand per product per warehouse, straight off the ledger.
create or replace view v_stock as
select
  p.id as product_id, p.sku, p.name, p.category, p.unit, w.id as warehouse_id, w.code as warehouse,
  coalesce(sum(m.qty), 0) as on_hand
from products p
cross join warehouses w
left join stock_moves m on m.product_id = p.id and m.warehouse_id = w.id
group by p.id, p.sku, p.name, p.category, p.unit, w.id, w.code;

-- The whole stock position per product: on hand across warehouses, open
-- demand (unshipped quantities on open and part orders), incoming purchase
-- quantities, and the dates that decide what to promise.
create or replace view v_stock_position as
select
  p.id, p.sku, p.name, p.category, p.unit, p.cost_cents, p.price_cents,
  p.reorder_point, p.reorder_qty, p.hazardous, p.haz_class, p.haz_max_qty, p.active,
  s.name as supplier, s.lead_time_days,
  coalesce((select sum(m.qty) from stock_moves m where m.product_id = p.id), 0) as on_hand,
  coalesce((select sum(l.qty - l.qty_shipped) from so_lines l
            join sales_orders so on so.id = l.so_id
            where l.product_id = p.id and so.status in ('open', 'part')), 0) as allocated,
  coalesce((select sum(pl.qty - pl.qty_received) from po_lines pl
            join purchase_orders po on po.id = pl.po_id
            where pl.product_id = p.id and po.status in ('open', 'part')), 0) as on_order,
  coalesce((select sum(m.qty) from stock_moves m where m.product_id = p.id), 0)
    - coalesce((select sum(l.qty - l.qty_shipped) from so_lines l
                join sales_orders so on so.id = l.so_id
                where l.product_id = p.id and so.status in ('open', 'part')), 0) as available,
  (select min(po.expected_on) from po_lines pl
   join purchase_orders po on po.id = pl.po_id
   where pl.product_id = p.id and po.status in ('open', 'part') and pl.qty > pl.qty_received) as next_incoming_on,
  (select max(m.moved_at) from stock_moves m where m.product_id = p.id and m.kind = 'shipment') as last_shipped_at,
  (select min(m.moved_at) from stock_moves m where m.product_id = p.id) as first_movement_at
from products p
left join suppliers s on s.id = p.supplier_id;

-- The order board: every sales order still in play.
create or replace view v_order_board as
select
  so.id, so.so_no, so.customer_ref, cu.id as customer_id, cu.name as customer, cu.on_stop,
  so.status, so.ordered_on, so.required_by, so.shipped_at, w.code as warehouse,
  (select count(*) from so_lines l where l.so_id = so.id) as lines,
  coalesce((select sum(l.qty) from so_lines l where l.so_id = so.id), 0) as units,
  coalesce((select sum(l.qty - l.qty_shipped) from so_lines l where l.so_id = so.id), 0) as units_unshipped,
  coalesce((select sum(l.qty * l.price_cents) from so_lines l where l.so_id = so.id), 0) as value_cents,
  (select bool_or(l.price_desc is null) from so_lines l where l.so_id = so.id) as has_unpriced,
  (select bool_or(l.price_cents < l.cost_cents) from so_lines l where l.so_id = so.id) as has_below_cost,
  case when so.status in ('open', 'part') and so.required_by is not null and so.required_by < now()::date
       then (now()::date - so.required_by) end as days_late,
  case when so.status = 'open' then (now()::date - so.ordered_on) end as days_unshipped
from sales_orders so
join customers cu on cu.id = so.customer_id
left join warehouses w on w.id = so.warehouse_id;

-- Backorders: every unshipped quantity the current stock cannot cover, with
-- the incoming purchase order that will (or the loud absence of one).
create or replace view v_backorders as
select
  so.so_no, so.status as so_status, so.ordered_on, so.required_by,
  cu.name as customer, p.sku, p.name as product,
  (l.qty - l.qty_shipped) as qty_short,
  sp.available, sp.on_order, sp.next_incoming_on,
  l.price_cents, (l.qty - l.qty_shipped) * l.price_cents as value_cents
from so_lines l
join sales_orders so on so.id = l.so_id
join customers cu on cu.id = so.customer_id
join products p on p.id = l.product_id
join v_stock_position sp on sp.id = p.id
where so.status in ('open', 'part')
  and l.qty > l.qty_shipped
  and sp.available < 0;

-- The reorder run: what to buy, from live demand, reorder points and lead
-- times together. available + on_order at or under the reorder point.
create or replace view v_reorder as
select
  sp.id, sp.sku, sp.name, sp.supplier, sp.lead_time_days,
  sp.on_hand, sp.allocated, sp.available, sp.on_order, sp.reorder_point,
  greatest(sp.reorder_qty, sp.reorder_point - (sp.available + sp.on_order)) as suggested_qty,
  sp.cost_cents,
  sp.next_incoming_on
from v_stock_position sp
where sp.active and sp.reorder_point > 0
  and (sp.available + sp.on_order) <= sp.reorder_point;

-- Shipped and not yet invoiced: the money asleep.
create or replace view v_unbilled as
select
  so.so_no, so.id as so_id, cu.id as customer_id, cu.name as customer,
  p.sku, p.name as product,
  (l.qty_shipped - l.qty_invoiced) as qty_unbilled,
  l.price_cents,
  (l.qty_shipped - l.qty_invoiced) * l.price_cents as value_cents,
  l.last_shipped_at,
  (now()::date - l.last_shipped_at::date) as days_unbilled,
  l.id as so_line_id
from so_lines l
join sales_orders so on so.id = l.so_id
join customers cu on cu.id = so.customer_id
join products p on p.id = l.product_id
where l.qty_shipped > l.qty_invoiced and so.status <> 'cancelled';

-- Debtors, aged.
create or replace view v_debtors as
select
  i.id, i.number, cu.name as customer, i.issued_on, i.due_on, i.status, i.total_cents,
  case when i.status = 'sent' and i.due_on < now()::date then (now()::date - i.due_on) end as days_overdue,
  case
    when i.status <> 'sent' then null
    when i.due_on >= now()::date then 'current'
    when now()::date - i.due_on <= 30 then '1-30'
    when now()::date - i.due_on <= 60 then '31-60'
    else '60+'
  end as bucket
from invoices i
join customers cu on cu.id = i.customer_id
where i.status <> 'paid';

-- Customer position: what they owe plus shipped-unbilled goods, against the
-- credit limit, and how long since they last ordered.
create or replace view v_customer_position as
select
  cu.id as customer_id, cu.name as customer, cu.price_tier, cu.terms_days,
  cu.credit_limit_cents, cu.on_stop, cu.status,
  cu.terms_signed_on, cu.ppsr_registered_on, cu.address,
  coalesce((select sum(i.total_cents) from invoices i where i.customer_id = cu.id and i.status = 'sent'), 0) as owing_cents,
  coalesce((select sum(u.value_cents) from v_unbilled u where u.customer_id = cu.id), 0) as unbilled_cents,
  coalesce((select sum(i.total_cents) from invoices i where i.customer_id = cu.id and i.status = 'sent'), 0)
    + coalesce((select sum(u.value_cents) from v_unbilled u where u.customer_id = cu.id), 0) as exposure_cents,
  (select count(*) from sales_orders so where so.customer_id = cu.id and so.status in ('open', 'part', 'on-hold')) as open_orders,
  (select max(so.ordered_on) from sales_orders so where so.customer_id = cu.id and so.status <> 'cancelled') as last_order_on,
  (now()::date - (select max(so.ordered_on) from sales_orders so where so.customer_id = cu.id and so.status <> 'cancelled')) as quiet_days
from customers cu;

-- Margin per product, last 28 days of shipments, off the stamped line prices
-- and the cost snapshots.
create or replace view v_margins as
select
  p.id as product_id, p.sku, p.name as product, p.category,
  sum(l.qty_shipped) as units_shipped,
  sum(l.qty_shipped * l.price_cents) as revenue_cents,
  sum(l.qty_shipped * l.cost_cents) as cost_cents,
  sum(l.qty_shipped * (l.price_cents - l.cost_cents)) as margin_cents,
  case when sum(l.qty_shipped * l.price_cents) > 0
       then round(100.0 * sum(l.qty_shipped * (l.price_cents - l.cost_cents)) / sum(l.qty_shipped * l.price_cents))::integer
       end as margin_pct
from so_lines l
join sales_orders so on so.id = l.so_id
join products p on p.id = l.product_id
where l.qty_shipped > 0 and l.last_shipped_at >= now() - interval '28 days' and so.status <> 'cancelled'
group by p.id, p.sku, p.name, p.category;

-- Dead stock: held over 90 days, no sale in 90 days, no open demand.
create or replace view v_dead_stock as
select
  sp.id, sp.sku, sp.name, sp.category, sp.on_hand, sp.cost_cents,
  (sp.on_hand * sp.cost_cents) as value_cents,
  sp.last_shipped_at,
  (now()::date - sp.first_movement_at::date) as days_held
from v_stock_position sp
where sp.active and sp.on_hand > 0 and sp.allocated = 0
  and sp.first_movement_at < now() - interval '90 days'
  and (sp.last_shipped_at is null or sp.last_shipped_at < now() - interval '90 days');

-- Everything that wants a decision, worst first. One row per problem, with a
-- reason code the CLI and the views translate into words.
create or replace view v_attention as
select * from (

  -- Hazardous stock over the declared storage ceiling.
  select 'haz_over_threshold' as reason, sp.sku as label, null::text as customer, sp.supplier as who,
         null::integer as days, (sp.on_hand * sp.cost_cents)::bigint as amount_cents,
         (sp.on_hand || ' ' || sp.unit || ' of class ' || coalesce(sp.haz_class, '?') || ' on hand, declared ceiling ' || sp.haz_max_qty) as detail
  from v_stock_position sp
  where sp.active and sp.hazardous and sp.haz_max_qty is not null and sp.on_hand > sp.haz_max_qty

  union all
  -- Backordered with no purchase order behind it: the promise date is fiction.
  select 'backorder_no_po', b.sku, b.customer, null, (now()::date - b.ordered_on), b.value_cents::bigint,
         (b.so_no || ': ' || b.qty_short || ' short, available ' || b.available || ', NO incoming PO')
  from v_backorders b
  where b.next_incoming_on is null

  union all
  -- Below the reorder point with nothing on order to fix it.
  select 'reorder_due', r.sku, null, r.supplier, null, (r.suggested_qty * r.cost_cents)::bigint,
         ('available ' || r.available || ' + on order ' || r.on_order || ' vs reorder point ' || r.reorder_point || '; suggest ' || r.suggested_qty || ' (' || coalesce(r.lead_time_days || 'd lead', 'no supplier') || ')')
  from v_reorder r

  union all
  -- Purchase orders past their expected date.
  select 'po_overdue', po.po_no, null, s.name, (now()::date - po.expected_on), null,
         ('expected ' || to_char(po.expected_on, 'YYYY-MM-DD') || ', not received')
  from purchase_orders po
  join suppliers s on s.id = po.supplier_id
  where po.status in ('open', 'part') and po.expected_on is not null and po.expected_on < now()::date

  union all
  -- Orders past the customer's required date.
  select 'so_late', b.so_no, b.customer, null, b.days_late, b.value_cents::bigint,
         ('required ' || to_char(b.required_by, 'YYYY-MM-DD') || ', status ' || b.status)
  from v_order_board b
  where b.days_late is not null and b.days_late > 0

  union all
  -- Entered and going nowhere: nothing shipped after 3+ days.
  select 'so_stuck', b.so_no, b.customer, null, b.days_unshipped, b.value_cents::bigint,
         ('ordered ' || to_char(b.ordered_on, 'YYYY-MM-DD') || ', nothing shipped')
  from v_order_board b
  where b.days_unshipped is not null and b.days_unshipped >= 3

  union all
  -- A line with no price behind it: goods leaving for $0.
  select 'price_missing', so.so_no, cu.name, null, (now()::date - so.ordered_on), null,
         (p.sku || ' x ' || l.qty || ': no price matched, line is $0')
  from so_lines l
  join sales_orders so on so.id = l.so_id
  join customers cu on cu.id = so.customer_id
  join products p on p.id = l.product_id
  where l.price_desc is null and so.status in ('open', 'part', 'on-hold')

  union all
  -- A line priced below its cost snapshot.
  select 'below_cost', so.so_no, cu.name, null, null,
         (l.qty * (l.cost_cents - l.price_cents))::bigint,
         (p.sku || ' x ' || l.qty || ' at ' || to_char(l.price_cents / 100.0, 'FM$999,990.00') || ' against cost ' || to_char(l.cost_cents / 100.0, 'FM$999,990.00'))
  from so_lines l
  join sales_orders so on so.id = l.so_id
  join customers cu on cu.id = so.customer_id
  join products p on p.id = l.product_id
  where l.price_desc is not null and l.price_cents < l.cost_cents and so.status in ('open', 'part', 'on-hold')

  union all
  -- Shipped, still not billed after 3 days.
  select 'unbilled_shipped', u.so_no, u.customer, null, max(u.days_unbilled)::integer, sum(u.value_cents)::bigint,
         ('shipped, ' || sum(u.qty_unbilled) || ' units on no invoice')
  from v_unbilled u
  group by u.so_no, u.customer
  having max(u.days_unbilled) >= 3

  union all
  -- Invoices overdue.
  select 'invoice_overdue', d.number, d.customer, null, d.days_overdue, d.total_cents,
         ('due ' || to_char(d.due_on, 'YYYY-MM-DD') || ' (' || d.bucket || ')')
  from v_debtors d
  where d.days_overdue is not null and d.days_overdue > 0

  union all
  -- Drafts that never went out.
  select 'invoice_draft', d.number, d.customer, null, (now()::date - d.issued_on), d.total_cents,
         ('drafted ' || to_char(d.issued_on, 'YYYY-MM-DD') || ', never sent')
  from v_debtors d
  where d.status = 'draft' and (now()::date - d.issued_on) >= 3

  union all
  -- Exposure past the limit.
  select 'over_credit_limit', cp.customer, cp.customer, null, null, cp.exposure_cents,
         ('owing ' || to_char(cp.owing_cents / 100.0, 'FM$999,999,990') || ' + unbilled ' ||
          to_char(cp.unbilled_cents / 100.0, 'FM$999,999,990') || ' against a limit of ' ||
          to_char(cp.credit_limit_cents / 100.0, 'FM$999,999,990'))
  from v_customer_position cp
  where cp.status = 'active' and cp.credit_limit_cents is not null and cp.exposure_cents > cp.credit_limit_cents

  union all
  -- A regular gone quiet: no order in 45 days.
  select 'customer_quiet', cp.customer, cp.customer, null, cp.quiet_days, null,
         ('last order ' || to_char(cp.last_order_on, 'YYYY-MM-DD') || ', ' || cp.quiet_days || ' days ago')
  from v_customer_position cp
  where cp.status = 'active' and not cp.on_stop and cp.last_order_on is not null and cp.quiet_days > 45

  union all
  -- Stock adjustments with no reason recorded.
  select 'adjustment_no_reason', p.sku, null, null, (now()::date - m.moved_at::date), (abs(m.qty) * p.cost_cents)::bigint,
         (to_char(m.moved_at, 'YYYY-MM-DD') || ': ' || m.qty || ' ' || p.unit || ' adjusted with no reason (move ' || substr(m.id::text, 1, 8) || ')')
  from stock_moves m
  join products p on p.id = m.product_id
  where m.kind = 'adjustment' and (m.reason is null or m.reason = '')
    and m.moved_at >= now() - interval '30 days'

  union all
  -- Tasks past their date.
  select 'task_overdue', t.title, cu.name, null, (now()::date - t.due_on), null,
         ('due ' || to_char(t.due_on, 'YYYY-MM-DD'))
  from tasks t
  left join customers cu on cu.id = t.customer_id
  where t.status = 'open' and t.due_on is not null and t.due_on < now()::date

) a;
