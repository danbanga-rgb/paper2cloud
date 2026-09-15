# Build Spec — Store Paper Capture → QuickBooks Desktop

Name: **Paper2Cloud**. Version 1.0, 2026-09-15.

This document is the contract for the implementing agent. Sections marked **CONTRACT** must be implemented exactly as written (schemas, state machines, field names, acceptance thresholds). Everything else is guidance; deviate only with a written reason in the PR.

---

## 1. Purpose, scope, non-goals

**Problem.** A grocery store's staff receive vendor invoices (delivery drivers, DSD vendors, net-terms suppliers) and pay many of them with handwritten checks, often one check covering several invoices. Today photos of this paper are posted to a WhatsApp group and nothing reliable reaches QuickBooks. The owner has no view of what is owed to whom.

**Goal.** Replace the WhatsApp posting with a phone web app (PWA) that captures the paper, extracts the financial facts with a vision model, gets an on-the-spot confirmation from the uploader, and pushes clean Bills and Bill Payments into QuickBooks Desktop via qbXML with no accountant in the loop. Owner reviews exceptions only.

**In scope (MVP).**
- PWA for iPhone (installable, camera capture, offline queue, push notifications).
- Document types: invoice, credit memo, check, and "record-only" types (vendor statement, delivery slip, note).
- Extraction with per-field confidence; uploader confirmation card; vendor alias learning.
- Check-to-invoice application UI (one check → N bills, partial payments, credits).
- Owner dashboard: needs-attention queue, bills, payments, open AP by vendor, archive search.
- **Pay requests** (added after reading the real group chat): staff ask before writing a check ("Gold Coast $1581.51 and Calpak $1979.48, okay?"), the owner replies "Ok", then the check is written. The app models this: uploader selects open invoices → owner approves → the approved set pre-ticks the check confirm card (§10 S7). See ADR 0005.
- QuickBooks Desktop push via the **existing qbXML / Web Connector interface from the Synergie Timesheet App** (reused, not rebuilt): VendorQuery/VendorAdd, BillAdd, VendorCreditAdd, BillPaymentCheckAdd, with dedupe and a sync log.
- Approval-gated push first, feature-flag to fully automatic for confirmed documents.

**Non-goals (MVP).**
- Line-item / inventory capture (V2; stored outside QB).
- Due-date reminders or terms enforcement.
- Payments that arrive only through the bank feed (ACH, card, autopay) — these stay the owner's job in QB bank reconciliation.
- Any WhatsApp integration, official or unofficial.
- Multiple expense accounts per bill (MVP posts every bill to a single COGS account; the schema allows more later).

---

## 2. Actors

| Actor | Who | What they do |
|---|---|---|
| Uploader | Store staff (4–5 people), each with own login | Photograph invoices/checks, confirm or fix the extraction, tick which invoices a check pays, add notes. |
| Owner | Dan | Resolves exceptions, approves pushes (until auto-push is enabled), manages vendors and settings, reconciles the bank feed inside QB. |
| System | This app | Extract, resolve vendors, validate, stage, push to QB, notify. |

No accountant role exists in the system.

---

## 3. Architecture

```
iPhone PWA (Next.js, Vercel)
   │  direct upload (signed URL)                 push notifications (Web Push)
   ▼
Supabase: Auth · Postgres · Storage (private bucket) · Edge/Serverless functions
   │  on upload → extraction job
   ▼
Extraction service (serverless fn): vision LLM w/ JSON schema → extractions table
   │  on confirm → validation → bills / payments / applications
   ▼
QB staging (qb_sync rows, canonical JSON)
   │  polled by
   ▼
Existing qbXML Web Connector service (Timesheet App codebase) → QuickBooks Desktop
   (separate company file, always-on Windows machine)
```

**Stack decisions (fixed).** Next.js + TypeScript PWA on Vercel; Supabase for Auth (email magic link or 6-digit PIN per staff member), Postgres, Storage, and scheduled/edge functions; the Timesheet App's qbXML layer for the QB leg. Vision model behind a single `extract(imageUrls, docTypeHint)` interface so the provider can be swapped (start with Claude; keep prompts and schemas provider-neutral).

**Two independent halves.** Everything up to and including `qb_sync` rows must work with QB completely absent (Phase 1–2). The QB push is a consumer of `qb_sync`, nothing upstream knows about qbXML.

**Source adapters.** The PWA is the only production source. A second adapter, `whatsapp_export_import`, parses an exported WhatsApp chat (text file + media folder) into `documents`/`pages` with `source='whatsapp_export'`, used for the Phase 0 fixture set and one-time backfill. Keep the adapter interface trivial: `ingest(files[], meta) → document ids`.

---

## 4. Document types — CONTRACT

| `doc_type` | QB effect | Notes |
|---|---|---|
| `invoice` | `BillAdd` | May span multiple pages. **Usually photographed with the paying check lying on top** → classification `also_contains: ["check"]`, two documents share the page. Bill amount = `handwritten_adjusted_total` when present, else `total`. |
| `credit_memo` | `VendorCreditAdd` | DSD returns/shortages. Negative-total invoices are reclassified to this. |
| `check` | `BillPaymentCheckAdd` (or `CheckAdd` if applied to nothing) | One image may contain several checks → several documents. |
| `statement` | none directly; rows may **backfill bills** (exception `statement_backfill`) | Vendor statement with open invoices; extracted row by row (§6.3b). Staff bracket months by hand and pay a month per check. |
| `delivery_slip` | none (record) | No prices. |
| `note` | none (record) | Free text from uploader, e.g. "paid Frito driver $180 cash". Structured fields optional. Creates an exception for the owner if it mentions money. |
| `other` | none | Not a financial document; kept for audit, hidden from lists by default. |

---

## 5. Data model — CONTRACT (Postgres DDL)

All tables have `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz`. Money is `numeric(12,2)`. Row-level security on: uploaders see their own documents plus everything read-only in lists; owner role sees all.

```sql
create type user_role as enum ('uploader','owner');
create table app_users (
  id uuid primary key references auth.users(id),
  display_name text not null,
  role user_role not null default 'uploader',
  active boolean not null default true
);

create table vendors (
  id uuid primary key,
  name text not null,                     -- canonical, as it should appear in QB
  qb_list_id text unique,                 -- from VendorQuery/VendorAdd
  qb_edit_sequence text,
  default_expense_account_id uuid,        -- references qb_accounts, nullable in MVP (settings default)
  active boolean not null default true
);
create table vendor_aliases (             -- learned from uploader confirmations
  id uuid primary key,
  vendor_id uuid not null references vendors(id),
  alias_normalized text not null unique,  -- see §7 normalization
  source text not null                    -- 'uploader_confirm' | 'owner' | 'import'
);

create table qb_accounts (                -- cached AccountQuery
  id uuid primary key, qb_list_id text unique not null,
  name text not null, account_type text not null, active boolean default true
);

create type doc_source as enum ('pwa','whatsapp_export','email');
create type doc_status as enum (
  'received','extracting','extracted','needs_confirmation','confirmed',
  'needs_attention','approved','staged','pushed','failed','void');

create table documents (
  id uuid primary key,
  doc_type text not null,                 -- §4 values; may change after classification/confirmation
  status doc_status not null default 'received',
  source doc_source not null,
  uploader_id uuid references app_users(id),
  captured_at timestamptz not null,       -- from device or export
  batch_key text,                         -- groups a delivery session (invoice + its check), optional
  image_hash text,                        -- perceptual hash of first page for duplicate warning
  original_message_ref text,              -- whatsapp export line ref, else null
  notes text
);
create table pages (
  id uuid primary key,
  document_id uuid not null references documents(id) on delete cascade,
  page_no int not null,
  storage_path text not null,             -- private bucket
  width int, height int, bytes int,
  unique (document_id, page_no)
);

create table extractions (                -- immutable, versioned model output
  id uuid primary key,
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,                   -- 1..n; re-runs append
  model text not null, prompt_version text not null,
  classification jsonb not null,          -- §6.1
  payload jsonb not null,                 -- §6.2 / §6.3 typed by doc_type
  overall_confidence numeric(4,3) not null,
  issues text[] not null default '{}',
  latency_ms int, cost_usd numeric(8,5),
  unique (document_id, version)
);

create table bills (                      -- one per invoice or credit_memo document
  id uuid primary key,
  document_id uuid not null unique references documents(id),
  vendor_id uuid not null references vendors(id),
  kind text not null check (kind in ('bill','credit')),
  ref_number text not null,               -- invoice number as printed; see §7.4 fallback
  txn_date date not null,
  due_date date,
  subtotal numeric(12,2), tax numeric(12,2),
  total numeric(12,2) not null check (total >= 0),
  expense_account_id uuid references qb_accounts(id),
  memo text,
  qb_txn_id text unique,
  unique (vendor_id, ref_number, kind)    -- dedupe rule
);

create table payments (                   -- one per check document (or cash note in future)
  id uuid primary key,
  document_id uuid not null unique references documents(id),
  vendor_id uuid not null references vendors(id),   -- payee
  method text not null default 'check' check (method in ('check','cash','other')),
  check_number text,                       -- required when method='check'
  txn_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  bank_account_id uuid references qb_accounts(id),
  memo text,
  qb_txn_id text unique,
  unique (vendor_id, check_number)         -- dedupe rule for checks
);
create table payment_applications (
  id uuid primary key,
  payment_id uuid not null references payments(id) on delete cascade,
  bill_id uuid not null references bills(id),
  amount numeric(12,2) not null check (amount > 0),  -- for kind='credit' bills this is credit applied
  unique (payment_id, bill_id)
);

create table pay_requests (                -- staff asks "can I pay these?"; owner answers (ADR 0005)
  id uuid primary key,
  vendor_id uuid not null references vendors(id),
  requested_by uuid not null references app_users(id),
  status text not null default 'requested' check (status in ('requested','approved','declined','fulfilled','cancelled')),
  note text,
  decided_by uuid references app_users(id), decided_at timestamptz, decision_note text,
  payment_id uuid references payments(id)   -- set when the check photo arrives and is applied
);
create table pay_request_items (
  pay_request_id uuid not null references pay_requests(id) on delete cascade,
  bill_id uuid not null references bills(id),
  amount numeric(12,2) not null,
  primary key (pay_request_id, bill_id)
);

create type sync_status as enum ('queued','sent','ok','error','skipped');
create table qb_sync (
  id uuid primary key,
  entity text not null check (entity in ('vendor','bill','credit','payment')),
  entity_id uuid not null,
  op text not null,                         -- 'VendorAdd','BillAdd','VendorCreditAdd','BillPaymentCheckAdd','CheckAdd'
  request_json jsonb not null,              -- canonical payload, §9
  depends_on uuid references qb_sync(id),   -- payment depends on its bills' sync rows
  status sync_status not null default 'queued',
  attempts int not null default 0,
  qb_txn_id text, qb_error_code text, qb_error_text text,
  sent_at timestamptz, completed_at timestamptz,
  unique (entity, entity_id, op)
);

create table exceptions (
  id uuid primary key,
  document_id uuid references documents(id),
  reason text not null,                     -- §8 codes
  detail jsonb,
  resolved_by uuid references app_users(id),
  resolved_at timestamptz, resolution text
);

create table audit_log (
  id bigserial primary key, at timestamptz default now(),
  actor_id uuid, action text not null, entity text, entity_id uuid, diff jsonb
);

create table settings (key text primary key, value jsonb not null);
-- keys: default_cogs_account_id, default_bank_account_id, auto_push_enabled (bool),
--       auto_push_min_confidence (numeric, default 0.90), extraction_model, prompt_version
```

**V2 hook (do not build now, do not block):** `bill_lines(bill_id, line_no, description, sku, qty, unit_cost, ext_cost)` for inventory, never pushed to QB.

---

## 6. Extraction — CONTRACT

Single function `extract(pages[], hint)` where `hint ∈ {invoice, check, credit_memo, statement, delivery_slip, unknown}` comes from the button the uploader pressed. Two model calls per document.

### 6.1 Classification output

```json
{
  "doc_type": "invoice|credit_memo|check|statement|delivery_slip|note|other",
  "documents_in_image": 1,
  "is_continuation_of_previous": false,
  "legibility": "good|fair|poor",
  "confidence": 0.0
}
```
`also_contains` lists other kinds physically in the same photo (the store lays the check on the invoice it pays). One `documents` row per kind, all sharing the same `pages` rows; each gets its own confirm card, and the check card is pre-ticked with the invoice from the same photo.

Rules: if `hint` and `doc_type` disagree with confidence ≥ 0.8, use the model's type and tell the uploader ("This looks like a credit memo, not an invoice — correct?"). `documents_in_image > 1` is only valid for `check`; the system then splits into N documents sharing the same page.

### 6.2 Invoice / credit memo payload

```json
{
  "vendor_name_printed": {"value": "SYSCO SAN FRANCISCO", "confidence": 0.97},
  "vendor_address": {"value": "...", "confidence": 0.6},
  "invoice_number": {"value": "48812", "confidence": 0.95},
  "invoice_date": {"value": "2026-09-12", "confidence": 0.9},
  "due_date": {"value": null, "confidence": 0.0},
  "terms": {"value": "NET 14", "confidence": 0.7},
  "subtotal": {"value": 812.10, "confidence": 0.9},
  "tax": {"value": 30.00, "confidence": 0.9},
  "total": {"value": 842.10, "confidence": 0.98},
  "is_credit": false,
  "paid_stamp_or_cod": {"value": false, "confidence": 0.8},
  "check_number_referenced": {"value": null, "confidence": 0.0},
  "paid_date_referenced": {"value": null, "confidence": 0.0},
  "handwritten_adjusted_total": {"value": null, "confidence": 0.0},
  "handwritten_notes": [],
  "page_count_seen": 2,
  "issues": ["subtotal+tax != total by 0.00"]
}
```
Rules: dates ISO-8601; amounts as numbers, never strings; credits are stored as positive amounts with `kind='credit'` (the sign lives in the kind, never in `total`); `null` with confidence 0 when absent; `issues` is free text for anything the model could not reconcile. Post-processing (not the model) checks `subtotal + tax == total` within $0.02, negative totals → `is_credit=true`, and page-count vs pages uploaded.

**Handwritten adjusted total.** Staff cross out the printed total after returns and write the real amount owed (confirmed against the vendor's statement in the fixture set). `bills.total` = adjusted figure when present with confidence ≥ 0.85; below that the confirm card shows both and the uploader picks. `bills.printed_total` (migration 0002) keeps the printed figure.

### 6.3b Statement payload

See `StatementPayloadSchema` in `src/lib/contracts/extraction.ts`: vendor, statement date, one row per printed line (`invoice|credit|payment`, ref, amount, due), `total_balance`, `handwritten_groups` (month brackets with their handwritten sums), `handwritten_notes`. On confirm: rows whose `(vendor, ref_number)` are unknown create bills in `needs_attention` with reason `statement_backfill` (owner accepts without a photo); known rows reconcile open balances and raise `amount_mismatch` if they differ. A handwritten group offers "ask to pay this group" (ADR 0005).

### 6.3 Check payload (array, one per check found)

```json
[{
  "check_number": {"value": "1047", "confidence": 0.93},
  "payee": {"value": "Pepsi Bottling", "confidence": 0.85},
  "amount_numeric": {"value": 1264.50, "confidence": 0.9},
  "amount_written": {"value": "One thousand two hundred sixty-four and 50/100", "confidence": 0.8},
  "date": {"value": "2026-09-12", "confidence": 0.9},
  "memo": {"value": "inv 22910, 22987", "confidence": 0.7},
  "memo_invoice_numbers": ["22910","22987"],
  "signed": true,
  "issues": []
}]
```
Rules: `amount_numeric` vs parsed `amount_written` disagreement → issue + confidence of amount capped at 0.5 → forces uploader to type the amount. Bank routing/account numbers are **never** extracted or stored (see §12).

### 6.4 Confidence and thresholds

`overall_confidence` = min of the required fields (vendor, ref/check number, date, total/amount). Field ≥ 0.85 shows as normal; < 0.85 shows highlighted on the confirm card; < 0.5 shows empty and required. Store every model response verbatim in `extractions` with `prompt_version`; re-extraction creates version n+1, never overwrites.

### 6.5 Operational

Images are downscaled to ≤ 2000 px long edge before sending. Timeout 30 s, one retry, then `needs_attention` with reason `extraction_failed`. Track `cost_usd` per call; alert if daily spend > $5.

---

## 7. Vendor resolution — CONTRACT

1. Normalize `vendor_name_printed`: uppercase, strip punctuation, collapse whitespace, drop legal suffixes (INC, LLC, CO, CORP), drop city/state tokens found in `vendor_address`.
2. Exact match in `vendor_aliases.alias_normalized` → vendor.
3. Else trigram similarity (`pg_trgm`) against `vendors.name` and aliases; if best ≥ 0.6 and second-best < 0.45, propose it (uploader sees "Sysco? ✓ / change").
4. Else uploader picks from a searchable list or taps "New vendor" (owner gets an exception `new_vendor` to approve the name before QB `VendorAdd`; the bill can be confirmed meanwhile).
5. Every uploader confirmation writes the alias. Aliases are the learning; the model never sees the vendor list.

**7.4 Missing invoice number.** If none is printed (handwritten DSD tickets), `ref_number = 'NOINV-' + yyyymmdd + '-' + last4(document_id)`, flagged on the card so the uploader can type one if it exists.

**7.5 Duplicate detection.** Before confirm: same `(vendor_id, ref_number, kind)` exists → block with "Already captured on <date> by <name>" and link; `image_hash` within Hamming distance 6 of an existing page → warn, allow.

---

## 8. Document state machine — CONTRACT

```
received ──(pages stored)──► extracting ──► extracted ──► needs_confirmation
                                   │ fail                        │ uploader confirms
                                   ▼                             ▼
                              needs_attention ◄───── validation fails ──┐
                                   ▲                        confirmed ──┘ passes
                                   │ owner resolves              │
                                   │                             ▼ (auto if auto_push_enabled && conf ≥ min, else owner)
                                   └───────────────────────── approved ──► staged ──► pushed
                                                                             │ QB error
                                                                             ▼
                                                                          failed ──(owner)──► needs_attention
void: reachable from any state except pushed (owner only). Pushed docs are corrected in QB, never here.
```

Exception reason codes: `statement_backfill` (bill created from a statement row, no photo), `extraction_failed`, `low_confidence`, `new_vendor`, `duplicate_suspected`, `amount_mismatch` (check ≠ sum of applications), `unapplied_payment` (check with no bills ticked), `multi_vendor_check`, `type_conflict`, `qb_error`, `money_note` (a note mentioning an amount), `over_applied` (application > bill open balance).

Validation on confirm: required fields present; check applications sum exactly to amount (or the uploader explicitly chose "leave $X unapplied"); every application ≤ bill open balance; payee vendor == every applied bill's vendor.

---

## 9. QuickBooks mapping — CONTRACT

Canonical `request_json` is produced by the app; the Timesheet App's qbXML layer renders and submits it. Ordering: vendor rows before bill rows before payment rows (`depends_on`). Never send a payment whose bills are not `ok`.

**Startup / nightly:** `AccountQuery` (cache into `qb_accounts`), `VendorQuery` (upsert `vendors` by `qb_list_id`; never overwrite a canonical name the owner edited — store QB's name as an alias).

**Vendor** → `VendorAdd { Name }` → store `ListID`, `EditSequence`.

**Bill** → `BillAdd { VendorRef.ListID, TxnDate, RefNumber = ref_number, Memo = "Paper2Cloud doc <short id>, uploaded by <name>", ExpenseLineAdd[{ AccountRef.ListID = expense_account (settings default_cogs_account_id in MVP), Amount = total }] }`. Pre-check: `BillQuery` by `RefNumber` + vendor over ±90 days; if found, mark sync `skipped`, copy its `TxnID`, exception `duplicate_suspected` for owner.

**Credit memo** → `VendorCreditAdd` with the same shape; store `TxnID`.

**Check** → `BillPaymentCheckAdd { PayeeEntityRef.ListID, APAccountRef (default AP), TxnDate, BankAccountRef.ListID = default_bank_account_id, IsToBePrinted=false, RefNumber = check_number, Memo, AppliedToTxnAdd[ { TxnID = bill.qb_txn_id, PaymentAmount = application.amount, SetCredit[{ CreditTxnID = credit.qb_txn_id, AppliedAmount }] } ] }`. Credits are applied inside the same request when a `payment_applications` row points at a `kind='credit'` bill. Total of `PaymentAmount` must equal `amount`.

**Check with no applications** (owner chose to record anyway) → `CheckAdd { PayeeEntityRef, AccountRef = bank, RefNumber, ExpenseLineAdd[{ AccountRef = COGS, Amount }] }`.

**Idempotency.** `(entity, entity_id, op)` unique; the Web Connector callback writes `qb_txn_id` and `status`. On `error`, keep the row, increment `attempts`, surface `qb_error` exception with QB's `statusMessage`; owner can retry or void. Max 3 automatic retries for transient errors (connection, busy file), none for validation errors.

**Reconciliation aid.** Nothing to build: with `RefNumber = check_number` and exact amounts, QB bank-feed matching is one click. Payments that only exist in the bank feed (ACH, card) are matched by the owner in QB as today.

---

## 10. PWA screens and flows

**Login.** Magic link or PIN; session persists on the device. Owner can deactivate a user.

**Home.** Three big buttons: **Invoice**, **Check**, **Other** (statement / delivery slip / note). Below: today's uploads with status chips. Badge for items awaiting the uploader's confirmation.

**Capture (invoice).** Camera opens immediately (`<input type="file" accept="image/*" capture="environment">`, plus "choose from photos"). After each shot: thumbnail strip, "Add page", "Done". Client-side: downscale, JPEG q≈0.8, perceptual hash, enqueue upload (IndexedDB) and continue working offline; a service worker retries.

**Processing.** Card with skeleton fields, typically 5–10 s. If the app is backgrounded, a push notification brings them back to the confirm card.

**Confirm card (invoice).** Vendor (proposed, tap to change), invoice #, date, total, credit toggle. Highlighted fields for low confidence. Buttons: **Confirm**, **Fix**, **Flag for owner** (with a one-line reason). Duplicate block per §7.5.

**Confirm card (check).** One card per check found. Check #, payee, amount, date. Then **"Which invoices does this pay?"**: list of the payee's open bills (newest first, each with open balance), pre-ticked from `memo_invoice_numbers` and from any invoice captured by the same user in the last 15 minutes with the same vendor. Running total vs check amount shown in red until equal; a "partial" control per bill to type a smaller amount; open credits listed as tick-to-apply. If nothing matches: "Invoice not captured yet — capture it now" (opens invoice flow and links back) or "Leave unapplied" (creates `unapplied_payment` exception).

**Ask to pay (S16).** From Home ("Ask to pay") or from a vendor's open invoices: tick invoices, optional note, send. Owner sees it in the queue as `pay_request` with Approve / Decline / "Pay a different set"; the uploader gets a push with the answer. When a check for that vendor is later confirmed, the approved request's invoices are pre-ticked (ahead of memo and 15-minute rules) and the request becomes `fulfilled`. Open approved requests show on Open AP as "approved to pay".

**Note.** Free text + optional vendor + optional amount; creates `money_note` exception if amount present.

**History.** The user's own documents with status; tap to see images and what happened (including QB TxnID once pushed).

**Owner dashboard (desktop/tablet web, same app, `owner` role).** Needs-attention queue (one action per row: resolve, edit, void, retry); Bills and Payments tables with filters and CSV export; **Open AP by vendor** (sum of open balances, oldest invoice date, list of open invoices — this is the payment-planning view); Archive search (vendor, date range, amount, uploader, text of memo/notes) with image viewer; Vendors (merge, rename, aliases, default account); Settings (accounts, auto-push toggle and threshold, model/prompt version, users).

---

## 11. Auto-push policy — CONTRACT

A confirmed document is auto-approved when **all** hold: `auto_push_enabled = true`; `overall_confidence ≥ auto_push_min_confidence` **or** every low-confidence field was edited by the uploader; vendor has `qb_list_id`; no open exception on the document; for checks, applications sum equals amount. Otherwise it waits in the owner queue. Owner approval of a row moves it to `approved` regardless of confidence. Default at launch: `auto_push_enabled = false`.

---

## 12. Security, privacy, operations

- Storage bucket private; images served via short-lived signed URLs (≤ 10 min). Check images contain bank routing/account numbers: the app never extracts, displays, or stores those values, and uploader-role users can only open their own check images.
- RLS as in §5; owner-only routes server-checked, not just hidden.
- Audit log on every status change, field edit, vendor merge, and QB push.
- Retention: keep images indefinitely (audit evidence) — this replaces the accountant's screenshot archive. Nightly Postgres backup; Storage versioning on.
- Monitoring: extraction failure rate, median time-to-confirm, exceptions open > 7 days, QB sync errors, daily model spend. One daily summary email/push to the owner.
- Cost expectation at a few hundred documents/month: model < $30, Supabase/Vercel free-to-hobby tiers.

---

## 13. Phase 0 fixture set and acceptance tests — CONTRACT

**Fixture set.** ≥ 100 real images exported from the existing WhatsApp group via the `whatsapp_export_import` adapter, covering: ≥ 40 invoices (including ≥ 10 multi-page, ≥ 5 credit memos, ≥ 5 handwritten DSD tickets with no invoice number), ≥ 30 checks (including ≥ 5 photos with 2+ checks and ≥ 5 with memo invoice lists), ≥ 10 statements/delivery slips, ≥ 5 non-financial photos. Each has a hand-labeled ground truth JSON in the §6 shapes. Labels are the owner's responsibility; the agent builds the labeling helper (a page that shows the image next to the model's draft for correction).

**Extraction thresholds (must pass before Phase 1 ships).**
- Classification accuracy ≥ 98%.
- Invoice `total` exact match ≥ 97%; `invoice_number` ≥ 95%; `vendor_name_printed` normalized match ≥ 95%; `invoice_date` ≥ 95%.
- Check `amount` exact ≥ 97%; `check_number` ≥ 95%; count of checks per image exact 100%.
- Low-confidence flagging must catch ≥ 90% of the wrong values (i.e. wrong-but-confident < 10% of errors).

**End-to-end tests.** (a) Two-page invoice → confirm → bill row correct → `qb_sync` BillAdd payload matches golden JSON. (b) Check covering two invoices plus one credit → applications validate → BillPaymentCheckAdd payload with two `AppliedToTxnAdd` and one `SetCredit`, sums equal. (c) Duplicate invoice re-uploaded → blocked. (d) Check amount ≠ applications → cannot confirm; "leave unapplied" → exception created. (e) New vendor → exception → owner approves → VendorAdd precedes BillAdd via `depends_on`. (f) Offline capture of 3 documents → all uploaded and extracted after reconnect. (g) QB error on BillAdd → payment row stays `queued`, exception raised, retry succeeds after fix.

**QB tests** run against a throwaway company file on the QB machine using the Timesheet App's existing Web Connector harness; verify TxnIDs round-trip and BillQuery dedupe.

---

## 14. Phasing and exit criteria

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 — Fixtures | Export importer, labeling helper, extraction service, prompt tuning | §13 thresholds met on the fixture set. |
| 1 — Capture | PWA (login, capture, offline, confirm cards), documents/extractions/bills/payments tables, basic owner lists | Store runs it alongside WhatsApp for 3 weeks; ≥ 90% of paper captured in-app; median time-to-confirm < 2 min. |
| 2 — Control | Vendor master + aliases, check application UI, pay requests, exceptions queue, open-AP view, archive search | Owner queue < 10 items/week; every check applied or explicitly unapplied. |
| 3 — QB push | `qb_sync` producer, integration with existing qbXML layer, dedupe, retries, approval-gated | One full month pushed with zero manual QB entry; bank-feed matching one click per check. |
| 4 — Autopilot | Auto-push flag on, daily summary, WhatsApp posting stopped | Owner intervention only via exceptions queue. |

V2 candidates (not scheduled): `bill_lines` inventory capture from well-formatted invoices; payment-planning suggestions ("pay these before Friday"); email intake adapter reusing the Clover-closeout app's mailbox pattern; folding the Clover closeout feed into this platform so QB has a single feeder.

---

## 14b. Migration 0002 (to write in Phase 1, after findings)

`bills.printed_total numeric(12,2)`; `settings.default_expense_account_id_services`; add `statement_backfill` to the `exceptions.reason` check constraint; `statements` table (document_id, vendor_id, statement_date, total_balance) and `statement_rows` (statement_id, kind, ref_number, amount, txn_date, due_date, bill_id nullable). See `docs/FINDINGS-real-paper.md`.

## 15. Assumptions and open items

- QuickBooks Desktop, separate company file, Web Connector on an always-on Windows machine; the Timesheet App's qbXML service will be given a second connector config pointing at this file.
- One COGS expense account for grocery vendors in MVP (`settings.default_cogs_account_id`) plus `settings.default_expense_account_id_services` for non-stock vendors (repairs, services); the new-vendor approval step asks the owner which applies, stored on `vendors.default_expense_account_id`. One checking account for all checks.
- Bills + payments (accrual AP) is the bookkeeping model; the owner will confirm with their tax preparer.
- Non-check payments (ACH, card, autopay) are handled in QB bank reconciliation, not captured.
- Staff use iPhones; Safari PWA capabilities (camera capture, home-screen install, Web Push) are sufficient.
- The uploader is the primary reviewer; the owner sees exceptions only.

## 16. Glossary

**DSD** direct-store-delivery vendor whose driver delivers and often collects a check on the spot. **Open balance** bill total minus applied payments and credits. **RefNumber** QB's user-visible reference (invoice number on bills, check number on payments). **TxnID / ListID** QB's internal ids for transactions / list entities. **Web Connector** Intuit's Windows service that polls a SOAP endpoint for qbXML requests and executes them against the company file.
