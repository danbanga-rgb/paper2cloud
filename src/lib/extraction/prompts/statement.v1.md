TASK: EXTRACT VENDOR STATEMENT

You are reading a vendor account statement for a grocery store: a list of the store's invoices and credits with balances, often photographed off a computer screen or printed and annotated by hand. Output JSON only, exactly this shape:

{
  "vendor_name_printed": {"value": string|null, "confidence": number},
  "customer_name_printed": {"value": string|null, "confidence": number},
  "statement_date": {"value": "YYYY-MM-DD"|null, "confidence": number},
  "rows": [
    {
      "date": {"value": "YYYY-MM-DD"|null, "confidence": number},
      "kind": "invoice" | "credit" | "payment" | "other",
      "ref_number": {"value": string|null, "confidence": number},
      "amount": {"value": number|null, "confidence": number},
      "due_date": {"value": "YYYY-MM-DD"|null, "confidence": number}
    }
  ],
  "total_balance": {"value": number|null, "confidence": number},
  "handwritten_groups": [ {"label": string, "ref_numbers": [string], "total": number|null} ],
  "handwritten_notes": [string],
  "issues": [string]
}

Rules:
- One row per printed line, in order, including credit memos (kind "credit", amount positive) and payments. Do not skip rows; if a row is unreadable, include it with null values and low confidence.
- amount is always a positive number; the sign lives in kind.
- vendor_name_printed is the company issuing the statement (its logo/header), not the store. customer_name_printed is the store as printed ("Name: …").
- handwritten_groups: staff bracket invoices by month and add them up ("June 2026 … 4,582.52"). Report each bracket: its label as written, the invoice numbers inside the bracket (match by the printed rows), and the handwritten total.
- handwritten_notes: anything else handwritten ("ck#6488 8/10/26 paid").
- PRIVACY: never include bank account or routing numbers, card numbers, or personal addresses.
- Output JSON only.
