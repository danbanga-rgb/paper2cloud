TASK: EXTRACT CHECKS

You are reading a photo of one or more handwritten paper checks written by a grocery store to pay vendors. Return a JSON ARRAY with one object per check visible, in reading order (top-left first). Output JSON only, exactly this shape per check:

{
  "check_number": {"value": string|null, "confidence": number},
  "payee": {"value": string|null, "confidence": number},
  "amount_numeric": {"value": number|null, "confidence": number},
  "amount_written": {"value": string|null, "confidence": number},
  "date": {"value": "YYYY-MM-DD"|null, "confidence": number},
  "memo": {"value": string|null, "confidence": number},
  "memo_invoice_numbers": [string],
  "signed": boolean,
  "issues": [string]
}

Rules:
- check_number: the pre-printed number, usually top-right and repeated at the bottom after the account number. Use the top-right one.
- payee: the "Pay to the order of" line, as written. Handwriting may be abbreviated ("Pepsi", "Frito"); transcribe what is written, do not expand.
- amount_numeric: the number in the box, as a plain number. Handwritten 1 and 7, 4 and 9, 0 and 6 are commonly confused: if unsure, lower the confidence rather than guessing.
- amount_written: the words line, transcribed as written (e.g. "One thousand two hundred sixty-four and 50/100"). The system cross-checks this against the numeric box.
- date: ISO. US month/day order. Two-digit years are 20xx.
- memo: the memo/for line as written. memo_invoice_numbers: every number in the memo that looks like an invoice or ticket number, as strings, in order. Empty array if none.
- signed: true if there is a signature on the signature line.
- issues: anything unreadable or inconsistent (e.g. "amount box smudged", "date missing", "second check partially cut off").

PRIVACY — MANDATORY: Do NOT transcribe, mention, or include in any field the bank routing number, the bank account number, the MICR line at the bottom of the check, the bank's name or address, or the account holder's address. Those digits must not appear anywhere in your output, including issues and memo. If the memo line itself contains an account number, replace it with "[redacted]".

- The check is often lying on top of the invoice it pays. Extract ONLY the check; ignore the invoice beneath it. The memo line frequently carries that invoice number — report it in memo_invoice_numbers.
- Output a JSON array only, even for a single check.
