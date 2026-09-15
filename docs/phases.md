# Phases and exit criteria

Work strictly in order. A phase is done when its exit criteria are demonstrably met (show the owner), not when the code exists. Check boxes in this file as you go; it is the project's progress record.

## Phase 0 — Fixtures and extraction (no app yet)

Goal: prove the vision model reads *this store's* paper well enough, and freeze the prompts.

- [ ] `npm install && npm test` green on the scaffold.
- [ ] Owner exports the WhatsApp group ("Export chat" → with media) and drops it in `fixtures/raw/` (git-ignored).
- [ ] `npm run import:whatsapp -- fixtures/raw/_chat.txt` produces `fixtures/images/*` and `fixtures/manifest.json` (sender, timestamp, filename per image). Parser is in `src/lib/ingest/whatsapp-export.ts`; the script only wires it to the filesystem.
- [ ] Implement `AnthropicProvider` (or the provider chosen in `.env`) behind `ExtractionProvider` in `src/lib/extraction/`. Prompts are the `v1` files; do not edit them in place.
- [ ] Build the labeling helper: a tiny local page (`npm run dev` → `/label`) that shows an image beside the model's draft JSON and saves corrected JSON to `fixtures/labels/<image>.json` in the §6 shapes.
- [ ] Owner labels ≥ 100 images meeting the mix in SPEC §13.
- [ ] `npm run fixtures:score` reports per-field accuracy and the wrong-but-confident rate; iterate prompts (v2, v3, …) until SPEC §13 thresholds pass. Record each run's numbers in `fixtures/SCORES.md`.

**Exit:** thresholds met; `settings.prompt_version` set to the winning version.

## Phase 1 — Capture

Goal: staff use the PWA instead of WhatsApp; the owner sees everything in lists.

- [ ] Supabase project: apply `0001_init.sql`, run `seed.sql`, create the `pages` bucket policies (private).
- [ ] Auth: magic link + optional PIN; `app_users` row created on first login by the owner (no self-signup).
- [ ] PWA shell: manifest, service worker with an IndexedDB upload queue, install prompt, Web Push subscription.
- [ ] Capture flows exactly as `design/screens.md` S2–S6 (invoice multi-page, check multi-per-image, other).
- [ ] Upload → `documents`/`pages` rows → extraction job → `extractions` row → status `needs_confirmation` → push notification.
- [ ] Migration 0002 per SPEC §14b (printed_total, services account, statement tables, statement_backfill reason).
- [ ] Composite photos: `also_contains` → one document per kind sharing the pages; check card pre-ticked from the invoice in the same photo.
- [ ] Confirm card (invoice) with adjusted-vs-printed total choice, low-confidence highlighting, vendor proposal (`src/lib/vendor/resolve.ts`), duplicate block (§7.5).
- [ ] Confirm writes `bills` via server route after `validateInvoiceConfirm`; alias learned.
- [ ] Owner: Bills list, Documents list, image viewer (signed URLs ≤ 10 min), CSV export.
- [ ] Check flow may stop at "amount/payee/check#" confirmation in this phase — application UI is Phase 2 — but the payment row is created and an `unapplied_payment` exception is raised so nothing is lost.

**Exit:** three weeks running alongside WhatsApp; ≥ 90% of paper captured in-app; median time-to-confirm < 2 minutes (measure it: `documents.updated_at` on confirm minus `captured_at`).

## Phase 2 — Control

Goal: every check is applied to invoices; the owner's queue is small.

- [ ] Vendor management screen: rename, merge (re-point aliases/bills/payments, audit-logged), default account, aliases list.
- [ ] Check confirm card with application UI (S7): open bills for payee, pre-ticks from memo and from same-user-last-15-min, running total, partial amounts, credits, "capture invoice now", "leave unapplied".
- [ ] `validatePaymentConfirm` enforced server-side; exceptions raised per §8 codes.
- [ ] Needs-attention queue (S10) with one-action resolution per reason code.
- [ ] Open AP by vendor (S12) from the `open_ap_by_vendor` view; archive search (S13).
- [ ] Notes with money → `money_note` exception.
- [ ] Statement confirm: rows reconcile/backfill bills (`statement_backfill`), handwritten month groups → "ask to pay this group".
- [ ] Pay requests (SPEC S16, ADR 0005): uploader ticks invoices → owner approves/declines from the queue → approved set pre-ticks the later check confirm → request `fulfilled`.

**Exit:** owner queue < 10 items/week for two consecutive weeks; zero checks left in `unapplied_payment` older than 7 days without an explicit owner decision.

## Phase 3 — QuickBooks push (approval-gated)

Goal: bills, credits, and payments appear in QB with no manual entry.

- [ ] `src/lib/qb/stage.ts` produces `qb_sync` rows (with `depends_on`) on `approved`. Golden payload tests in `tests/qb-stage.test.ts` pass against `fixtures/golden/*.json`.
- [ ] Consumer: the Timesheet App's qbXML/Web Connector service gets a second connector config for the store company file and a small adapter that reads `qb_sync` rows (`queued`, dependencies `ok`), renders qbXML, submits, and writes back `qb_txn_id`/status. Nightly `AccountQuery` + `VendorQuery` → `qb_accounts` / `vendors` (+ aliases with source `qb`).
- [ ] Dedupe: `BillQuery` by RefNumber+vendor ±90 days before every `BillAdd`; found → `skipped`, copy TxnID, `duplicate_suspected` exception.
- [ ] Retry policy (3 automatic for transient), `qb_error` exceptions, owner retry/void.
- [ ] Owner approves each document (auto-push flag stays off).

**Exit:** one full calendar month with zero manual QB entry for captured paper; owner confirms bank-feed matching is one click per check.

## Phase 4 — Autopilot

- [ ] Flip `auto_push_enabled` with `auto_push_min_confidence` per §11.
- [ ] Daily owner summary (push/email): captured, pushed, exceptions open, model spend.
- [ ] Monitoring thresholds from §12 wired to alerts.
- [ ] WhatsApp posting stops.

**Exit:** owner touches the system only via the exceptions queue.

## V2 backlog (not scheduled)

`bill_lines` inventory capture from well-formatted invoices (never pushed to QB); payment planning suggestions; email intake adapter; folding the Clover closeout feed into this platform.
