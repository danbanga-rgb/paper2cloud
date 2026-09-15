TASK: EXTRACT RECORD-ONLY DOCUMENT

This photo is a vendor statement, delivery slip, staff note, or something else that will be kept for records but not entered into accounting. Extract the minimum to make it findable later. Output JSON only:

{
  "vendor_name_printed": {"value": string|null, "confidence": number},
  "date": {"value": "YYYY-MM-DD"|null, "confidence": number},
  "summary": string,
  "amount_mentioned": {"value": number|null, "confidence": number},
  "issues": [string]
}

Rules:
- vendor_name_printed: the vendor on the paper, if any, as printed.
- date: the most prominent date on the page, ISO, US month/day order.
- summary: one sentence, max 160 characters, saying what this is (e.g. "Pepsi statement listing 4 open invoices, balance 2,310.40", "Handwritten note: paid Frito driver 180 cash").
- amount_mentioned: a single dominant amount if one exists (statement balance, note amount); otherwise null.
- PRIVACY: never include bank account or routing numbers, card numbers, or personal addresses.
- Output JSON only.
