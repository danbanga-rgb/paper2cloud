# Screens

Every screen the MVP has, what it shows, and what the user can do. Numbered so code, prototype, and spec can point at them. The prototype (`prototype/index.html`) implements each one with mocked data; hash routes match the IDs (`#s5`).

Design principles: one thumb; the common case takes under 15 seconds; low-confidence fields are visibly different, not hidden; every screen shows where the paper went next.

## Uploader (phone, PWA)

### S1 Home
Three large buttons: **Invoice**, **Check**, **Other**. Below: "Waiting for you" (documents in `needs_confirmation`, tap → S5/S6) then "Today" with status chips (Extracting… / Confirmed / Sent to QB / Needs owner). Badge on the History tab. Offline banner when queued uploads exist.

### S2 Capture — invoice
Camera opens immediately. After each shot the thumbnail joins a strip at the bottom. Buttons: **Add page**, **Done**. Tap a thumbnail to retake or delete. Also: "Choose from photos".

### S3 Capture — check
Same as S2 but the copy says "One photo can include several checks". Done → S4.

### S3b Capture — other
Chooser: Statement / Delivery slip / Note. Note opens a text box with optional vendor and amount (S8).

### S4 Processing
Card with the thumbnail and skeleton fields. "Reading… usually 5–10 s". If the user leaves, a push notification returns them to S5/S6. Failure → "Couldn't read this — retake or flag for owner".

### S5 Confirm — invoice
Fields: Vendor (proposed; tap → search list / New vendor), Invoice #, Date, Total, Credit memo toggle. Fields with confidence < 0.85 have an amber outline and label "check this"; < 0.5 are empty and required. Pages viewer (swipe). If the classifier disagreed with the button pressed: banner "This looks like a credit memo — switch?". Duplicate block replaces the buttons with "Already captured on 9/10 by Maria — view".
Buttons: **Confirm** (primary), **Flag for owner** (asks for one line), **Delete** (only before confirm; creates `void` by owner rule — in MVP uploader delete is allowed only while status is `needs_confirmation` and is audit-logged).

### S6 Confirm — check (one card per check found)
Fields: Check #, Payee (vendor, proposed), Amount, Date, Memo. Amount gets the amber outline when numeric vs written disagree. Then a **"Which invoices does this pay?"** section → S7 inline. If a photo held 3 checks, a stepper "Check 1 of 3" at the top; each confirms separately.

### S7 Apply to invoices (inside S6)
List of the payee's open bills (newest first): ref #, date, open balance, checkbox. Pre-ticked from memo numbers and from any invoice this user captured in the last 15 minutes for this vendor. Open credits listed under "Credits to apply". Each ticked row can be made partial (tap amount → edit). Sticky footer: "Applied $X of $Y" turning green when equal. Links: **Invoice not here — capture it now** (→ S2, returns here with it pre-ticked), **Leave $Z unapplied** (requires a reason chip: "invoice coming later" / "overpayment" / "not sure").
Confirm is disabled until applied == amount or an unapplied reason is chosen.

### S16 Ask to pay
Entry: Home button "Ask to pay", or a vendor row on the uploader's open-invoices list. Pick vendor → tick open invoices (same list component as S7) → optional note → Send. Status chip afterwards: Asked · Approved · Declined. Owner side: appears in S10 as its own group with Approve / Decline / edit-the-set; approved requests show on S12 as "approved to pay". When the matching check is confirmed (S6), those invoices are pre-ticked first.

### S8 Note
Text box; optional vendor picker; optional amount. "Save". If amount present, tells the user "the owner will see this".

### S9 History
This user's documents, newest first, status chip, tap → read-only detail with pages, extracted fields, and "In QuickBooks as Bill #… (TxnID)" once pushed.

## Owner (tablet/desktop web; same app, owner role)

### S10 Needs attention
Queue grouped by reason code. Each row: thumbnail, one-line summary, who/when, and ONE primary action per reason:
- new_vendor → "Approve vendor" (edit name inline) / "Merge into…"
- duplicate_suspected → "It's a duplicate — void" / "Not a duplicate"
- amount_mismatch / over_applied / unapplied_payment → opens S6/S7 as owner
- low_confidence / extraction_failed → "Send back to uploader" / "Fix myself"
- type_conflict → pick the type
- money_note → "Record as cash payment (V2)" / "Just keep the note"
- qb_error → shows QB message; "Retry" / "Void"
Secondary: "Approve" appears on rows in `confirmed` when auto-push is off (bulk select supported).

### S11 Bills · Payments
Tables with filters (vendor, date range, status, uploader), totals row, CSV export, click → detail with pages and QB status. Payments detail lists applications.

### S12 Open AP by vendor
One row per vendor: open AP, # open invoices, oldest open date; expand → the open invoices. Sort by amount or age. This is the payment-planning view. Includes unapplied checks as a separate line so the number is honest.

### S13 Archive search
Full-text over vendor, ref #, memo, note text, uploader; date and amount ranges; results with thumbnails; open → viewer. Replaces the accountant's screenshot folder.

### S14 Vendors
List with open AP, alias count, QB link status. Detail: rename, aliases (add/remove), default expense account, merge into another vendor (audit-logged; re-points bills, payments, aliases).

### S15 Settings
COGS account, bank account (from cached QB accounts), auto-push toggle + min confidence, prompt version, users (invite by email, role, deactivate), daily summary recipients.

## Not screens, but visible everywhere
- Status chip vocabulary: Reading · Waiting for you · Confirmed · Needs owner · Approved · Sending · In QuickBooks · Failed · Voided.
- Amounts always `$1,264.50`; dates `Sep 12` in lists and `2026-09-12` in detail.
