# Drop samples here (git-ignored)

- The WhatsApp export: `_chat.txt` plus its media files, exactly as exported ("Export chat" → with media).
- Or loose sample photos of invoices and checks — any filenames.

Then: `npm run import:whatsapp -- fixtures/raw/_chat.txt` (for an export) to populate `fixtures/images/`.
Check photos never get committed; see fixtures/README.md.
