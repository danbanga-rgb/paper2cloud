-- Paper2Cloud 0001_init — implements SPEC.md §5 (CONTRACT).
-- Append-only: never edit this file once applied; add 0002_*.sql.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role as enum ('uploader','owner');
create type doc_source as enum ('pwa','whatsapp_export','email');
create type doc_status as enum (
  'received','extracting','extracted','needs_confirmation','confirmed',
  'needs_attention','approved','staged','pushed','failed','void');
create type sync_status as enum ('queued','sent','ok','error','skipped');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role user_role not null default 'uploader',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create trigger app_users_updated before update on app_users for each row execute function set_updated_at();

create or replace function current_role_is_owner() returns boolean language sql stable as $$
  select exists (select 1 from app_users where id = auth.uid() and role = 'owner' and active)
$$;

-- ---------------------------------------------------------------------------
-- QuickBooks reference data (cached)
-- ---------------------------------------------------------------------------
create table qb_accounts (
  id uuid primary key default gen_random_uuid(),
  qb_list_id text unique not null,
  name text not null,
  account_type text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create trigger qb_accounts_updated before update on qb_accounts for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------
create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qb_list_id text unique,
  qb_edit_sequence text,
  default_expense_account_id uuid references qb_accounts(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index vendors_name_ci on vendors (lower(name));
create index vendors_name_trgm on vendors using gin (name gin_trgm_ops);
create trigger vendors_updated before update on vendors for each row execute function set_updated_at();

create table vendor_aliases (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  alias_normalized text not null unique,
  source text not null check (source in ('uploader_confirm','owner','import','qb')),
  created_at timestamptz not null default now()
);
create index vendor_aliases_trgm on vendor_aliases using gin (alias_normalized gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Documents, pages, extractions
-- ---------------------------------------------------------------------------
create table documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in
    ('invoice','credit_memo','check','statement','delivery_slip','note','other')),
  status doc_status not null default 'received',
  source doc_source not null,
  uploader_id uuid references app_users(id),
  captured_at timestamptz not null,
  batch_key text,
  image_hash text,
  original_message_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index documents_status on documents (status);
create index documents_uploader_captured on documents (uploader_id, captured_at desc);
create index documents_image_hash on documents (image_hash);
create trigger documents_updated before update on documents for each row execute function set_updated_at();

create table pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  page_no int not null check (page_no >= 1),
  storage_path text not null,
  width int, height int, bytes int,
  created_at timestamptz not null default now(),
  unique (document_id, page_no)
);

create table extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version int not null check (version >= 1),
  model text not null,
  prompt_version text not null,
  classification jsonb not null,
  payload jsonb not null,
  overall_confidence numeric(4,3) not null check (overall_confidence between 0 and 1),
  issues text[] not null default '{}',
  latency_ms int,
  cost_usd numeric(8,5),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

-- ---------------------------------------------------------------------------
-- Financial records
-- ---------------------------------------------------------------------------
create table bills (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references documents(id),
  vendor_id uuid not null references vendors(id),
  kind text not null check (kind in ('bill','credit')),
  ref_number text not null,
  txn_date date not null,
  due_date date,
  subtotal numeric(12,2),
  tax numeric(12,2),
  total numeric(12,2) not null check (total >= 0),
  expense_account_id uuid references qb_accounts(id),
  memo text,
  qb_txn_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (vendor_id, ref_number, kind)
);
create index bills_vendor_date on bills (vendor_id, txn_date desc);
create trigger bills_updated before update on bills for each row execute function set_updated_at();

create table payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references documents(id),
  vendor_id uuid not null references vendors(id),
  method text not null default 'check' check (method in ('check','cash','other')),
  check_number text,
  txn_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  bank_account_id uuid references qb_accounts(id),
  memo text,
  qb_txn_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint payments_check_number_required check (method <> 'check' or check_number is not null),
  unique (vendor_id, check_number)
);
create index payments_vendor_date on payments (vendor_id, txn_date desc);
create trigger payments_updated before update on payments for each row execute function set_updated_at();

create table payment_applications (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  bill_id uuid not null references bills(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, bill_id)
);
create index payment_applications_bill on payment_applications (bill_id);

-- Open balance per bill: total minus applied payments (credits reduce via SetCredit; modelled as applications too)
create or replace view bill_open_balances as
select b.id as bill_id, b.vendor_id, b.kind, b.ref_number, b.txn_date, b.total,
       b.total - coalesce(sum(pa.amount), 0) as open_balance
from bills b
left join payment_applications pa on pa.bill_id = b.id
join documents d on d.id = b.document_id and d.status <> 'void'
group by b.id;

create or replace view open_ap_by_vendor as
select v.id as vendor_id, v.name,
       sum(case when ob.kind = 'bill' then ob.open_balance else -ob.open_balance end) as open_ap,
       min(case when ob.kind = 'bill' and ob.open_balance > 0 then ob.txn_date end) as oldest_open_invoice,
       count(*) filter (where ob.kind = 'bill' and ob.open_balance > 0) as open_invoice_count
from vendors v
join bill_open_balances ob on ob.vendor_id = v.id
group by v.id;

-- ---------------------------------------------------------------------------
-- QuickBooks staging
-- ---------------------------------------------------------------------------
create table qb_sync (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('vendor','bill','credit','payment')),
  entity_id uuid not null,
  op text not null check (op in ('VendorAdd','BillAdd','VendorCreditAdd','BillPaymentCheckAdd','CheckAdd')),
  request_json jsonb not null,
  depends_on uuid references qb_sync(id),
  status sync_status not null default 'queued',
  attempts int not null default 0,
  qb_txn_id text,
  qb_error_code text,
  qb_error_text text,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (entity, entity_id, op)
);
create index qb_sync_status on qb_sync (status, created_at);
create trigger qb_sync_updated before update on qb_sync for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Exceptions, audit, settings
-- ---------------------------------------------------------------------------
create table exceptions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  reason text not null check (reason in (
    'extraction_failed','low_confidence','new_vendor','duplicate_suspected','amount_mismatch',
    'unapplied_payment','multi_vendor_check','type_conflict','qb_error','money_note','over_applied')),
  detail jsonb,
  resolved_by uuid references app_users(id),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now()
);
create index exceptions_open on exceptions (created_at) where resolved_at is null;

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  diff jsonb
);
create index audit_log_entity on audit_log (entity, entity_id);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security (SPEC §5, §12)
-- Uploaders: full read of vendors/accounts/settings; own documents read/write;
--            other users' documents visible in lists but check images restricted (enforced at the
--            signed-URL API layer, since Storage policies can't join to documents cheaply).
-- Owner: everything.
-- Service role (server routes, extraction worker, qb consumer) bypasses RLS.
-- ---------------------------------------------------------------------------
alter table app_users            enable row level security;
alter table vendors              enable row level security;
alter table vendor_aliases       enable row level security;
alter table qb_accounts          enable row level security;
alter table documents            enable row level security;
alter table pages                enable row level security;
alter table extractions          enable row level security;
alter table bills                enable row level security;
alter table payments             enable row level security;
alter table payment_applications enable row level security;
alter table qb_sync              enable row level security;
alter table exceptions           enable row level security;
alter table audit_log            enable row level security;
alter table settings             enable row level security;

create policy owner_all on app_users            for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on vendors              for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on vendor_aliases       for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on qb_accounts          for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on documents            for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on pages                for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on extractions          for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on bills                for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on payments             for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on payment_applications for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on qb_sync              for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on exceptions           for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on audit_log            for all using (current_role_is_owner()) with check (current_role_is_owner());
create policy owner_all on settings             for all using (current_role_is_owner()) with check (current_role_is_owner());

create policy self_read on app_users for select using (id = auth.uid());
create policy uploader_read on vendors        for select using (auth.uid() is not null);
create policy uploader_read on vendor_aliases for select using (auth.uid() is not null);
create policy uploader_read on qb_accounts    for select using (auth.uid() is not null);
create policy uploader_read on settings       for select using (auth.uid() is not null and key in ('default_cogs_account_id','default_bank_account_id'));

create policy uploader_own_docs on documents for all
  using (uploader_id = auth.uid()) with check (uploader_id = auth.uid());
create policy uploader_list_docs on documents for select using (auth.uid() is not null);
create policy uploader_own_pages on pages for all
  using (exists (select 1 from documents d where d.id = pages.document_id and d.uploader_id = auth.uid()))
  with check (exists (select 1 from documents d where d.id = pages.document_id and d.uploader_id = auth.uid()));
create policy uploader_own_extractions on extractions for select
  using (exists (select 1 from documents d where d.id = extractions.document_id and d.uploader_id = auth.uid()));
create policy uploader_read_bills on bills for select using (auth.uid() is not null);
create policy uploader_read_payments on payments for select using (auth.uid() is not null);
create policy uploader_read_applications on payment_applications for select using (auth.uid() is not null);
create policy uploader_own_exceptions on exceptions for select
  using (exists (select 1 from documents d where d.id = exceptions.document_id and d.uploader_id = auth.uid()));
-- Writes to bills/payments/applications/vendor_aliases from uploaders go through server routes (service role)
-- after validation (src/lib/validation/confirm.ts); no direct client writes.

-- ---------------------------------------------------------------------------
-- Storage bucket (private). Signed URLs only, ≤ 10 min (SPEC §12).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('pages', 'pages', false)
  on conflict (id) do nothing;
