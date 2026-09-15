# What the real paper looks like — findings from the first 39 photos (Aug 10 – Sep 14, 2026)

Read this before touching extraction, the confirm cards, or the data model. It corrects assumptions in the original spec; the spec and contracts have been updated to match (commit "findings: real paper").

## 1. The check is photographed lying on top of the invoice it pays
Nearly every payment photo is a composite: the written check placed over the invoice, one photo. The employee also writes "paid", the check number and date on the invoice itself, and the invoice number on the check's memo line. Consequences:
- Classification has `also_contains` (e.g. `["check"]`); extraction runs a separate pass per companion and the app creates two `documents` rows sharing the page.
- The invoice extractor must ignore the check (and vice versa). Prompts say so explicitly.
- Check application (S7) can usually be pre-ticked with certainty: the invoice is in the same photo and its number is on the memo line. Confirm should be one tap in this case.
- Check images almost always show the MICR line (routing + account). SPEC §12 rules are not theoretical.

## 2. Handwritten adjustments change the amount owed
Example: Sudni Foods invoice 653279 printed $750.04; staff wrote "I return drumsticks 1 box", crossed out the total and wrote 750.04 − 60.52 = 689.52. The vendor's own statement later shows the open balance as $689.52. So the bill should be booked at the handwritten adjusted figure, with the printed total kept for audit. Contract: `handwritten_adjusted_total` on the invoice payload; confirm card shows both and defaults to the adjusted one when its confidence ≥ 0.85, otherwise requires the uploader to choose.

## 3. Vendor statements are central, not incidental
The largest vendor (Sudni) sends monthly statements; one showed 18 open invoices totalling $11,386.36. Staff bracket invoices by month on the printout, add them up by hand, and pay a month at a time with one check ("June 2026 = 4,582.52", six invoices). This is exactly one-check-many-invoices, and the statement is how they decide the set. Consequences:
- Statement extraction gets its own schema (`StatementPayloadSchema`, rows + handwritten groups) and prompt (`statement.v1.md`).
- Statements should be able to **backfill bills** that were never photographed: a statement row with an unknown (vendor, ref_number) becomes a bill in `needs_attention` with reason `statement_backfill` (new exception code — add to SPEC §8 and the DB check constraint in migration 0002) so the owner can accept it without a photo. Otherwise Open AP will never be right for vendors on terms.
- A handwritten month group on a statement is a natural pay request (ADR 0005): offer "ask to pay this group" from the statement's confirm card.

## 4. Handwritten tallies across vendors are a real document type
"Thai Golden Spices 1,921.19 + GMS 1,135.63 = 3,056.82", "CalPak 1979.48 + Gold Coast 1581.51 + Sudni 4582.52 = 8,143.51 — 3 invoices this is total". These are the employee's payment plan for the week, written on the back of whatever invoice is handy, and posted for the owner's OK. They are the paper form of a pay request. Classifier: `note` when it's the main content; otherwise reported in the invoice's `handwritten_notes`. The app should turn them into pay requests rather than lose them.

## 5. Not everything is COGS
Ever Kool Climate Control, $460, "fix freezer": repairs and maintenance, not cost of goods. The MVP's single-COGS assumption survives for grocery vendors, but `vendors.default_expense_account_id` needs to be settable from day one and the vendor-approval step (new_vendor exception) should ask the owner to pick the account. Add a second default: `settings.default_expense_account_id_services`.

## 6. Delivery slips with no prices exist
Harris Ranch delivery: weights and item codes, billed to a distributor, no amounts. `delivery_slip`, record-only. Correctly out of QB.

## 7. Per-unit prices written beside line items
Gold Coast invoice: the employee wrote a unit cost next to each line (case price ÷ units) for shelf pricing. This is the V2 inventory hook already noted in the spec; `handwritten_notes` captures the raw text so nothing is lost meanwhile.

## 8. Volume and photo quality
39 photos in five weeks, roughly 30–40 a month, one uploader (Shaista), the owner replying "Ok". That is far below the "hundreds of invoices" estimate — either most invoices never reach the group (likely: only ones needing a decision), or volume is seasonal. Either way the fixture bar in SPEC §13 (≥ 100 labeled images with a set mix) should be met by including older months, and the Phase 1 exit metric "≥ 90% of paper captured in-app" needs a denominator: count paper invoices received per week for one week by hand.
Photos are phone shots at an angle on a desk, some glare, thermal paper, handwritten forms (CalPak). All were readable to a human at 1024px. 2000px downscale is fine.

## 9. The group is an approval channel
Every check is preceded by "can I pay X and Y, okay?" and an "Ok". See ADR 0005 (pay requests). Without it the app does not replace the group.

## Fixture notes
`fixtures/raw/` holds `chat.txt` (without-media export) and the 39 WhatsApp Web downloads; `npm run import:whatsapp -- fixtures/raw/chat.txt` matches them by timestamp (30 match; the 9 from Aug 10–14 predate the text export and import with sender unknown). Check photos must never be committed.
