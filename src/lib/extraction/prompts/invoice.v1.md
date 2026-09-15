TASK: EXTRACT INVOICE

You are reading a vendor invoice (or credit memo) delivered to a grocery store. The photos are the pages of ONE document, in order. Extract the fields below. Output JSON only, exactly this shape. Every field with a value also carries your confidence (0..1) that the value is exactly right; use null with confidence 0 when the field is absent or unreadable.

{
  "vendor_name_printed": {"value": string|null, "confidence": number},
  "vendor_address": {"value": string|null, "confidence": number},
  "invoice_number": {"value": string|null, "confidence": number},
  "invoice_date": {"value": "YYYY-MM-DD"|null, "confidence": number},
  "due_date": {"value": "YYYY-MM-DD"|null, "confidence": number},
  "terms": {"value": string|null, "confidence": number},
  "subtotal": {"value": number|null, "confidence": number},
  "tax": {"value": number|null, "confidence": number},
  "total": {"value": number|null, "confidence": number},
  "is_credit": boolean,
  "paid_stamp_or_cod": {"value": boolean|null, "confidence": number},
  "check_number_referenced": {"value": string|null, "confidence": number},
  "paid_date_referenced": {"value": "YYYY-MM-DD"|null, "confidence": number},
  "handwritten_adjusted_total": {"value": number|null, "confidence": number},
  "handwritten_notes": [string],
  "page_count_seen": integer,
  "issues": [string]
}

Rules:
- vendor_name_printed: the vendor's name exactly as printed in the header/logo area, not the store's name (the store is the customer / "ship to" / "sold to"). Do not normalize or abbreviate.
- invoice_number: the vendor's invoice/ticket/document number as printed. Not the customer number, route number, PO number, or driver number. If the paper has several candidate numbers, prefer the one labeled Invoice, Inv, Ticket, or Document #. If there is truly none, null.
- invoice_date: the invoice/delivery date, ISO format. Assume US month/day order. Two-digit years are 20xx.
- total: the amount due for this document. On multi-page invoices it is on the last page. If a "balance due" and a "total" both appear, use the amount due after credits on this document. Amounts are plain numbers with a dot decimal, no currency symbols, never strings. Never guess a digit; lower the confidence instead.
- subtotal and tax: as printed; null if not shown. Do not compute them.
- is_credit: true for credit memos, returns, or when the total is negative. Report the total as a positive number and set is_credit true.
- paid_stamp_or_cod: true when the paper is marked PAID, COD, CASH, or shows a check number written on it.
- check_number_referenced / paid_date_referenced: staff often write "paid", the check number ("ck#6514") and a date on the invoice when they pay it. Report them here.
- handwritten_adjusted_total: staff sometimes cross out the printed total and write the amount actually owed after a return or shortage, often with the subtraction shown ("750.04 − 60.52 = 689.52"). Report that final handwritten figure here and leave `total` as printed. If nothing is crossed out or adjusted, null with confidence 0. Never invent an adjustment from a tally that lists other vendors.
- handwritten_notes: transcribe each handwritten note briefly, in order: returns ("I return drumsticks 1 box"), payment notes, per-line unit prices written beside items, and any tally of amounts (with the vendor names as written). Do not put the invoice's own printed fields here.
- If a check is lying on top of this invoice, IGNORE the check entirely; it is extracted separately. Do not read the check's amount as the invoice total.
- page_count_seen: how many distinct pages you were shown.
- issues: short notes about anything you could not reconcile (e.g. "subtotal+tax != total", "total cut off at bottom", "two different dates on page").
- Do NOT extract line items.
- Output JSON only.
