# PaperFlow

Store paper (vendor invoices, credit memos, handwritten checks) → phone capture → vision-model extraction → uploader confirmation → QuickBooks Desktop via qbXML. No accountant in the loop.

This repository is a **scaffold**: fixed contracts, migrations, prompts, pure logic with tests, stub routes, and a clickable prototype. It contains no working backend yet. Start with `SPEC.md`, then `CLAUDE.md`, then `docs/phases.md`.

## Layout

```
SPEC.md                      The build spec. CONTRACT sections are binding.
CLAUDE.md                    Rules for the implementing agent.
docs/phases.md               Phase checklists with exit criteria.
docs/adr/                    Decisions already made (don't relitigate).
design/screens.md            Every screen, its fields, and its actions.
design/prototype/index.html  Clickable mobile prototype with mocked data. Open on an iPhone.
supabase/migrations/         0001_init.sql — the spec §5 DDL, verbatim.
supabase/seed.sql            Settings defaults and a few vendors for dev.
src/lib/contracts/           Zod schemas + types: extraction, status machine, QB payloads.
src/lib/extraction/          Provider interface, prompt files (versioned).
src/lib/vendor/              Name normalization and resolution (pure).
src/lib/validation/          Confirm-time validation rules (pure).
src/lib/qb/                  Canonical → qb_sync request builder (pure). No qbXML here.
src/lib/ingest/              WhatsApp export parser (Phase 0 fixtures).
src/app/                     Next.js App Router stubs — every route exists, none is implemented.
fixtures/                    Phase 0 images, labels, golden QB payloads.
tests/                       Vitest for the pure modules.
```

## Getting started (Phase 0)

```bash
npm install
npm test                      # pure-logic tests must be green before you touch anything
cp .env.example .env.local    # fill in Supabase + model keys
```

Then follow `docs/phases.md`.

## Non-negotiables

Bank routing/account numbers on checks are never extracted or stored. Money is integer cents in code. The vision model never sees the vendor list. QuickBooks is a downstream consumer of `qb_sync` and nothing else knows it exists.
