# ADR 0005 — Pay requests: staff ask, owner approves, then the check is written

**Status:** proposed, 2026-09-15 (owner to accept or veto)

## Context
The exported group chat shows the real workflow is not just "post the paper". The store employee asks before writing checks, naming vendors and amounts ("next Wednesday Gold Coast $1581.51 and calpak $1979.48 ... this is okay for you right"), the owner answers "Ok", and only then the check is written and photographed. If Paper2Cloud replaces WhatsApp without this step, staff will keep WhatsApp for it and the app loses its position as the single place paper goes.

## Decision
Add a lightweight pay-request object: uploader selects open invoices for a vendor, owner approves or declines from the needs-attention queue, and the approved set pre-ticks the check confirm card when the check arrives. Two tables (`pay_requests`, `pay_request_items`), one uploader screen (S16), one queue group. No QuickBooks effect; nothing is posted until the check exists.

## Consequences
Payment planning becomes real data rather than chat: Open AP shows what is approved-to-pay. The check confirm card gets its best pre-tick source. Scope grows by one small screen in Phase 2. Rejected alternative: keep using WhatsApp for approvals — defeats the purpose.
