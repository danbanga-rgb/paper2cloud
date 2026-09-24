# Picking the work back up

State as of 2026-09-24. All work is on branch `feature/claude-cloud-build`; `main` is untouched.

- **Done:** Anthropic provider, migration 0002 (written, not applied), Phase 1 server plumbing, and the `/label` helper. 68 tests pass, and typecheck and build are clean.
- **Decided:** D1 = (a), meaning strict phase order. Phase 0 comes next.
- **Next:** Phase 0 step 4. Draft all 39 photos with prompt v1, then the owner reviews the first 10 before any scoring.
- **Still open:** D2–D6 in `docs/DECISIONS-NEEDED.md`.

---

## A. Local setup in VS Code (once)

Open a terminal in VS Code (Terminal → New Terminal) inside the `paper2cloud` folder.

```bash
git fetch origin
git checkout feature/claude-cloud-build
git pull
npm install
npm test            # expect 68 passing
```

Put the WhatsApp material in `fixtures/raw/`: `chat.txt` and the 39 downloaded photos, side by side. That folder is git-ignored, so the photos are never committed.

```bash
npm run import:whatsapp -- fixtures/raw/chat.txt
# expect: "39 images → fixtures/images/manifest.json" (30 matched to chat lines, 9 from Aug 10–14 without sender)
```

Create your local settings file:

```bash
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
```

Edit `.env.local` and set these three lines. The key comes from console.anthropic.com → Settings → API Keys → Create Key.

```
EXTRACTION_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
EXTRACTION_MODEL=claude-opus-5
```

Leave the Supabase and VAPID lines empty; they aren't needed until Phase 1. Never commit `.env.local` (it is git-ignored).

Start the helper:

```bash
npm run dev
# open http://localhost:3000/label
```

Click **Draft with model** on a photo. Each draft shows its cost, expected at about $0.10–0.20 per photo. Drafts are saved in `fixtures/drafts/`.

---

## B. Prompt for Claude Code in VS Code (local, has the photos)

Paste this as the first message:

```text
You are the implementing engineer for Paper2Cloud. Resume Phase 0 in this local checkout.

Orient first (don't skip): read CLAUDE.md, SPEC.md, docs/FINDINGS-real-paper.md, docs/phases.md,
docs/DECISIONS-NEEDED.md and docs/RESUME.md. Confirm you're on branch feature/claude-cloud-build,
then run `npm test` and `npm run typecheck`. Expect 68 passing. If not, stop and tell me.

State: the Anthropic provider (src/lib/extraction/providers/anthropic.ts) and the /label helper
(src/app/label, src/lib/fixtures/*) are built but have never run on a real photo. fixtures/images/
holds the 39 imported photos; .env.local has my API key and EXTRACTION_MODEL=claude-opus-5.

Task: Phase 0 step 4.
1. Write scripts/draft-fixtures.ts (+ npm script "fixtures:draft"). It drafts every image in
   fixtures/images that has no draft yet, using extractDocument + labelFromExtraction +
   FixtureStore.writeDraft (the same path as POST /api/label/draft). Hint "unknown", prompt
   version from EXTRACTION_PROMPT_VERSION (default v1). Run images one at a time. Print per-image
   cost and latency, and the total cost at the end. Before starting, print the estimated cost and
   ask me to confirm. Continue past a failed image and list the failures at the end.
   Never print model output for check photos (SPEC §12).
2. Run it on all 39.
3. Show me the first 10 side by side: for each image, the key fields of the draft (type, also_contains,
   vendor, invoice #, date, printed total, handwritten adjusted total, and for checks the check #,
   payee, amount and memo invoice #s) plus the questions it raised. I'll look at the photos in
   /label myself. Call out how it handled: Sudni invoice 653279 (handwritten 689.52 over printed
   750.04), the Ever Kool invoice with the check on top, the CalPak handwritten invoice with the
   check on top, and the Sudni statement photographed off a screen.
4. STOP. Do not score and do not write new prompt versions until I've reviewed.

Rules: never extract, log, display or store bank routing/account numbers; never commit anything
in fixtures/raw or fixtures/images (check photos); money is integer cents in logic; prompts are
versioned files, never edited in place once scored. Commit drafts (fixtures/drafts/*.json) and
the script as "phase0: draft fixtures with prompt v1" and push to feature/claude-cloud-build.
Pause at natural stopping points and ask whether I want a break.
```

After that: label in `/label` (answer the amber questions there), then return to Claude with
"Labels done for N photos. Implement scripts/score-fixtures.ts per SPEC §13 and score v1."

---

## C. Prompt for a Claude Code cloud session (no photos, no key)

A cloud container starts from a fresh clone. It won't have `fixtures/raw`, `fixtures/images` or
`.env.local`, so use cloud sessions for code that doesn't need them. Paste:

```text
You are the implementing engineer for Paper2Cloud. Continue on branch feature/claude-cloud-build
(create it locally from origin if needed). Do NOT commit to main. Push only to
feature/claude-cloud-build.

Orient first: read CLAUDE.md, SPEC.md, docs/FINDINGS-real-paper.md, docs/phases.md,
docs/DECISIONS-NEEDED.md and docs/RESUME.md. Run `npm install && npm test && npm run typecheck`.
Expect all tests green (68 as of 2026-09-24, more if later work added tests). Report in 3 lines:
current phase, what's done since RESUME.md, and which DECISIONS-NEEDED items are still open.

This container has no fixture photos and no API key. Don't try to run real extractions.
Use the mock provider (EXTRACTION_PROVIDER=mock) for anything that needs one.

Task for this session: <PICK ONE, e.g.
  - "Implement scripts/score-fixtures.ts per SPEC §13 against fixtures/labels/*.json and
     fixtures/drafts/*.json (score drafts vs labels, no model calls), with unit tests on synthetic labels."
  - "Apply my answers to D2–D6 in docs/DECISIONS-NEEDED.md: <answers>."
  - "Phase 1 (only once Phase 0 thresholds pass): <item from docs/phases.md>.">

Rules: phase order is fixed (CLAUDE.md rule 3); CONTRACT sections of SPEC.md are law. Objections
go to docs/DECISIONS-NEEDED.md, never silent changes. Money is integer cents; never handle bank
routing/account numbers; migrations are append-only. Commit after each completed item as
"phaseN: <what>". Pause at natural stopping points and ask whether I want a break.
```

---

## D. Useful commands

```bash
npm test                 # unit tests (run before every commit)
npm run typecheck
npm run dev              # local app; /label is the fixture helper (dev only)
npx next build           # production build check
git log --oneline -10    # what's been done
```
