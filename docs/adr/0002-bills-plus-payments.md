# ADR 0002 — Bills + Bill Payments (accrual AP), not checks-only

**Status:** accepted, 2026-09-15 (owner to confirm with tax preparer; does not block build)

## Context
Today QuickBooks holds only payments entered at bank reconciliation. One handwritten check commonly pays several invoices. The owner wants to know what is owed to each vendor and on which invoices.

## Decision
Every invoice becomes a QuickBooks Bill (`BillAdd`), every credit memo a Vendor Credit, every check a `BillPaymentCheckAdd` applied to specific bills (with credits applied via `SetCredit` in the same request). Checks that pay nothing on file become plain `CheckAdd` only by explicit owner choice.

## Consequences
Open-AP and payment-planning views come for free. Bank-feed matching is one click because the payment already exists with the real check number and amount. More transactions in QB, all machine-created. MVP posts every bill to one COGS account (`settings.default_cogs_account_id`); the schema allows per-vendor accounts later.
