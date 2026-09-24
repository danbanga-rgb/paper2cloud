-- Paper2Cloud 0002 — SPEC §14b, from docs/FINDINGS-real-paper.md. Append-only; NOT applied anywhere yet.
--   §2 handwritten adjusted totals  → bills.printed_total
--   §3 statements are central       → statements / statement_rows, exception reason statement_backfill
--   §5 not everything is COGS       → settings.default_expense_account_id_services

-- ---------------------------------------------------------------------------
-- Bills: keep the printed total when the bill is booked at the handwritten adjusted figure
-- ---------------------------------------------------------------------------
alter table bills add column printed_total numeric(12,2) check (printed_total is null or printed_total >= 0);
comment on column bills.printed_total is
  'Printed invoice total when staff crossed it out and wrote an adjusted amount (bills.total). Null when not adjusted.';

-- ---------------------------------------------------------------------------
-- Exceptions: statement_backfill (bill created from a statement row, no photo)
-- ---------------------------------------------------------------------------
alter table exceptions drop constraint exceptions_reason_check;
alter table exceptions add constraint exceptions_reason_check check (reason in (
  'extraction_failed','low_confidence','new_vendor','duplicate_suspected','amount_mismatch',
  'unapplied_payment','multi_vendor_check','type_conflict','qb_error','money_note','over_applied',
  'statement_backfill'));

-- ---------------------------------------------------------------------------
-- Settings: second default expense account for non-stock vendors (repairs, services)
-- ---------------------------------------------------------------------------
insert into settings (key, value) values ('default_expense_account_id_services', 'null')
  on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Vendor statements, row by row (SPEC §6.3b)
-- ---------------------------------------------------------------------------
create table statements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references documents(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  statement_date date not null,
  total_balance numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index statements_vendor_date on statements (vendor_id, statement_date desc);
create trigger statements_updated before update on statements for each row execute function set_updated_at();

create table statement_rows (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references statements(id) on delete cascade,
  kind text not null check (kind in ('invoice','credit','payment','other')),
  ref_number text,
  amount numeric(12,2) not null check (amount >= 0),   -- positive; kind carries the sign
  txn_date date,
  due_date date,
  bill_id uuid references bills(id),                   -- matched or backfilled bill; null until reconciled
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index statement_rows_statement on statement_rows (statement_id);
create index statement_rows_bill on statement_rows (bill_id) where bill_id is not null;
create trigger statement_rows_updated before update on statement_rows for each row execute function set_updated_at();

alter table statements     enable row level security;
alter table statement_rows enable row level security;

create policy owner_all on statements     for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on statement_rows for all using (current_role_is_owner()) with check (current_role_is_owner());
-- Statements are AP evidence like bills: every signed-in user may read; writes go through server routes.
create policy uploader_read_statements     on statements     for select using (auth.uid() is not null);
create policy uploader_read_statement_rows on statement_rows for select using (auth.uid() is not null);
