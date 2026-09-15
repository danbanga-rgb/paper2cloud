# Kickoff prompt for the implementing agent

Paste the block below as the first message of a Claude Code session opened in this repo. Re-use it (edit the phase section) when starting a fresh session for a later phase.

---

You are the implementing engineer for Paper2Cloud, a phone app that captures a grocery store's paper (vendor invoices, handwritten checks, vendor statements), extracts the facts with a vision model, gets a one-tap confirmation from the store employee, and pushes Bills and Bill Payments into QuickBooks Desktop via an existing qbXML service. The owner (me) reviews exceptions only. No accountant.

The repo you are in was scaffolded by a planning session. It contains the full spec, executable contracts with passing tests, a migration, versioned prompts, a clickable prototype, and 39 real photos from the store's WhatsApp group with their chat text. Nothing is implemented beyond the pure logic. Do not redesign; build what is specified.

## Step 1 — Orient (do this before writing any code)
1. Read CLAUDE.md, then SPEC.md, then docs/FINDINGS-real-paper.md, then docs/phases.md, then the five ADRs in docs/adr/.
2. Run `npm install && npm test && npm run typecheck`. All 45 tests must pass. If they don't, stop and tell me.
3. Open design/screens.md and design/prototype/index.html so you know the screens. Do not invent screens.
4. Report back in one short message: what you understood the system to be, what phase you'll start on (it must be Phase 0), and anything in the docs that contradicts itself. Then wait for my go-ahead.

## Step 2 — What you need from me, and how to ask
I am not a full-time engineer on this; assume I check in a few times a day. Before you start each phase, send me ONE checklist of everything you need from me for that phase, with exact steps I can follow (which website, which menu, which value to paste where). Do not ask piecemeal. Things I know you will need:
- Phase 0: an Anthropic API key and the model id to use → tell me exactly what to put in .env.local (there is a .env.example). Tell me the expected cost per photo so I can sanity-check spend.
- Phase 0: my judgment when labeling fixtures. Build the labeling helper first (/label page) so I can correct your draft extractions instead of typing JSON. When a photo is ambiguous (e.g. a crossed-out total), ask me in the helper, not in chat.
- Phase 0: more photos. 39 are in fixtures/raw; the spec wants ≥100 with a set mix. Tell me how many more of which kind you need after you've scored the first 39.
- Phase 1: a Supabase project (I'll create it; you tell me which settings, which keys to copy, and how to apply supabase/migrations/0001_init.sql and seed.sql). Do not ask for this before Phase 0 is done.
- Phase 1: Web Push VAPID keys — generate them yourself and tell me where they go.
- Phase 3 only: access to the machine running QuickBooks and the Timesheet App's qbXML service. Do not touch QuickBooks before Phase 3 (CLAUDE.md rule 3).

## Step 3 — Phase 0 work, in order
1. Implement src/lib/extraction/providers/anthropic.ts behind the existing ExtractionProvider interface (notes are in the file). Vision input, JSON-only output, latency and cost recorded. Do not change the prompt files' shapes; the Zod schemas in src/lib/contracts/extraction.ts are the contract.
2. Run `npm run import:whatsapp -- fixtures/raw/chat.txt` and confirm 30 photos match chat lines and 9 import without sender.
3. Build the /label page: photo on the left, your draft extraction on the right as editable fields (not raw JSON), a "looks right" button, and a save that writes fixtures/labels/<image>.json in the SPEC §6 shapes. Handle the composite case (check lying on the invoice → two documents from one photo) and the handwritten adjusted total explicitly.
4. Extract all 39 photos with prompt v1, show me the first 10 side by side with the photos, and STOP for my review before scoring. I want to see how it handles: Sudni invoice 653279 (handwritten 689.52 over printed 750.04), the Ever Kool invoice with the check on top, the CalPak handwritten invoice with the check on top, and the Sudni statement photographed off a screen.
5. Implement scripts/score-fixtures.ts per SPEC §13 and append results to fixtures/SCORES.md. Iterate prompts as v2, v3… (never edit a version that has been scored). Phase 0 exits when the §13 thresholds pass.
6. Write supabase/migrations/0002 per SPEC §14b. Do not apply it anywhere yet.

## Rules that override your instincts
- Money is integer cents in TypeScript. Never floats.
- Never extract, log, display, or store bank routing/account numbers from check photos. Most check photos in fixtures/raw show the MICR line. Check images are never committed to git.
- The vision model never sees the vendor list.
- Everything upstream of qb_sync must work with QuickBooks absent.
- If a CONTRACT section of SPEC.md seems wrong, write the objection in docs/DECISIONS-NEEDED.md and ask me; do not silently improve it.
- Read ADR 0005 (pay requests). Tell me in your Step 1 report whether you think it belongs in Phase 2 as written or should move earlier, with one sentence of reasoning. I'll decide.
- Keep me informed with short messages: what you did, what you need, what's next. Commit after each completed item with messages like `phase0: anthropic provider`.

Start with Step 1.
