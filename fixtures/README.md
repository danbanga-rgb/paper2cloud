# Fixtures

- `raw/` (git-ignored): the WhatsApp export as dropped by the owner (`_chat.txt` + media).
- `images/` (git-ignored): images copied/renamed by `npm run import:whatsapp`; `manifest.json` next to them records sender, timestamp, caption, suggested batch.
- `labels/<image>.json`: hand-corrected ground truth in the SPEC §6 shapes, plus `{"doc_type": ..., "pages": [...]}` for multi-page documents. Committed.
- `golden/`: canonical QB payloads pinned by `tests/qb-stage.test.ts`. Change only with a spec change.
- `SCORES.md`: one row per `npm run fixtures:score` run (prompt version, model, per-field accuracy, wrong-but-confident rate).

Never commit an image of a check. Check fixtures stay local; their labels (which contain no bank numbers) are committed.
