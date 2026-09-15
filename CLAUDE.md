# CLAUDE.md — rules for any agent working in this repo

You are implementing **Paper2Cloud**, a store paper-capture app that pushes Bills and Bill Payments into QuickBooks Desktop. Read `SPEC.md` before anything else. This file tells you how to work; the spec tells you what to build.

## Ground rules

1. **Sections of `SPEC.md` marked CONTRACT are law.** Field names, enum values, table names, JSON shapes, state transitions, thresholds. If you believe a contract is wrong, stop and write the objection in `docs/DECISIONS-NEEDED.md`; do not silently "improve" it.
2. **The typed contracts in `src/lib/contracts/` are the executable form of the spec.** Import from them. Never redefine a shape locally. If the spec and a contract file disagree, the spec wins and you fix the contract file.
3. **Phase order is fixed** (see `docs/phases.md`). Do not write QuickBooks code before Phase 3. Do not build inventory / line items at all (V2).
4. **Everything upstream of `qb_sync` must work with QuickBooks absent.** No module outside `src/lib/qb/` may import qbXML concepts.
5. **The vision model never sees the vendor list.** Vendor resolution is `src/lib/vendor/`, deterministic, alias-driven (spec §7).
6. **Never extract, log, display, or store bank routing or account numbers from check images** (spec §12). Prompts already forbid it; keep it that way.
7. **Pure logic gets tests.** `src/lib/validation`, `src/lib/vendor`, `src/lib/contracts/status.ts`, `src/lib/qb/stage.ts` are pure and covered by Vitest in `tests/`. Run `npm test` before every commit.
8. **Migrations are append-only.** Never edit `supabase/migrations/0001_init.sql` after it has been applied anywhere; add `0002_...`.
9. **Prompts are versioned files** under `src/lib/extraction/prompts/`. Changing a prompt means a new file with a bumped version and a bumped `settings.prompt_version`; extractions record which version produced them.
10. **Don't invent screens.** The uploader and owner screens are enumerated in `design/screens.md` and prototyped in `design/prototype/index.html`. Match the flows; styling is yours.

## Working conventions

- Next.js App Router, TypeScript strict, Zod for every boundary (API bodies, model output, settings).
- Supabase JS client; row-level security is the authorization model — server routes still check role.
- Money is `numeric(12,2)` in Postgres and **integer cents** in TypeScript (`amountCents`). Convert at the DB boundary only. Never use floating point for money in logic.
- Dates from documents are `YYYY-MM-DD` strings (no timezone). Timestamps are ISO with timezone.
- Keep the extraction provider behind `ExtractionProvider` (`src/lib/extraction/extract.ts`). Adding a provider = new file, no changes elsewhere.
- Commit messages: `phaseN: <what>`; one PR per spec section where practical.
- When something is unclear, prefer the option that keeps the uploader's flow shortest. The uploader is a busy store employee holding a piece of paper.

## Definition of done per phase

See `docs/phases.md`. A phase is done when its exit criteria are demonstrably met, not when its code exists.
