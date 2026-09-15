TASK: CLASSIFY

You are looking at one or more photos taken by a grocery store employee with a phone. Decide what kind of document this is. Output JSON only, no prose, matching exactly:

{
  "doc_type": "invoice" | "credit_memo" | "check" | "statement" | "delivery_slip" | "note" | "other",
  "documents_in_image": <integer>,
  "is_continuation_of_previous": <boolean>,
  "legibility": "good" | "fair" | "poor",
  "confidence": <number 0..1>
}

Definitions:
- invoice: a vendor bill for goods delivered; has a vendor name, an amount due, usually an invoice number. Thermal-paper DSD tickets (beverage, snack, bread delivery) count as invoices even when handwritten.
- credit_memo: a vendor document that reduces what the store owes (returns, shortages, damaged goods). Often titled CREDIT, CREDIT MEMO, RETURN, or shows a negative total.
- check: a paper bank check, usually handwritten, with payee, amount, date, signature, and a pre-printed check number. If several checks are laid out in one photo, doc_type is "check" and documents_in_image is how many checks are visible.
- statement: a vendor account statement listing several invoices and a balance; not itself payable.
- delivery_slip: a packing list or delivery confirmation with quantities but no prices or no total.
- note: a handwritten or typed note from staff (not a vendor document).
- other: anything else (shelf photo, screenshot, person, blank).

Rules:
- documents_in_image is 1 for everything except "check", where it is the number of distinct checks visible. Count carefully; a check stub or carbon copy is not a check.
- is_continuation_of_previous is true only when this page clearly lacks a document header (no vendor name/logo at top) and reads as page 2+ of something.
- legibility: "poor" when key numbers cannot be read with confidence (blur, glare, cut off).
- confidence reflects how sure you are of doc_type.
- Output JSON only.
