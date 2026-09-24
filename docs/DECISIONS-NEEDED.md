# Decisions needed from the owner

Append here when a CONTRACT seems wrong or a choice isn't covered. One entry per item: context, options, recommendation, and leave the decision line blank for the owner.

## Open

### D2 — `pay_requests` tables are in SPEC §5 but not in 0001
**Context.** SPEC §5 (CONTRACT) defines `pay_requests` and `pay_request_items`, but `0001_init.sql` does not create them. §14b's list for 0002 doesn't include them either. ADR 0005 is still "proposed".
**Options.** (a) Add them in `0003_pay_requests.sql` once ADR 0005 is accepted. (b) Fold them into 0002 now.
**Recommendation.** (a). 0002 stays exactly as §14b specifies.
**Decision:**

### D3 — Where Web Push subscriptions are stored
**Context.** Phase 1 requires "push notification" when extraction finishes, but no table in §5 holds browser push subscriptions (endpoint + keys per user/device).
**Options.** (a) New table `push_subscriptions(id, user_id → app_users, endpoint unique, p256dh, auth, created_at, last_used_at)` in a new migration, owner-only plus own-row RLS. (b) Store them as JSON on `app_users`.
**Recommendation.** (a). The worker has a TODO where the send goes.
**Decision:**

### D4 — Phase 1 exit criterion disagrees between SPEC and phases.md
**Context.** SPEC §14 says "≥ 90% of paper captured in-app; median time-to-confirm < 2 min". `docs/phases.md` (updated after FINDINGS §8) says "Open AP by vendor matches the vendors' statements for the top 3 vendors". FINDINGS says the phases file is the updated one.
**Recommendation.** Update the SPEC §14 table to match phases.md.
**Decision:**

### D5 — Small doc inconsistencies (no behaviour impact)
- SPEC §6.1's JSON example omits `also_contains`, though the text under it and `ClassificationSchema` include it. Recommend adding it to the example.
- `docs/phases.md` says `fixtures/raw/_chat.txt`, but FINDINGS and the kickoff prompt say `fixtures/raw/chat.txt`.
**Decision:**

### D6 — Getting fixture photos into a session
**Context.** `fixtures/raw/*` is git-ignored (check photos show MICR lines and must never be committed). A cloud session therefore starts without them.
**Options.** (a) Run Phase 0 extraction and labeling locally with `npm run dev` on your machine. (b) Upload the zip into a private Supabase Storage bucket once Phase 1's project exists, and have scripts read from there.
**Recommendation.** (a) for Phase 0.
**Decision:**

## Resolved

_(move entries here with the decision and date)_

### D1 — Phase order for cloud sessions (2026-09-24)
**Context.** `docs/KICKOFF-PROMPT.md` and CLAUDE.md rule 3 say work starts at Phase 0 and phases run strictly in order. The 2026-09-24 session brief asked for Phase 1 foundation. The 39 fixture photos are git-ignored, so they are not in cloud containers, and no API key is configured there. That makes Phase 0 extraction runs impossible in the cloud as things stand.
**What was done.** Only work that needs no credentials and no photos: the Anthropic provider (Phase 0 item), migration 0002 (listed in both phases, not applied), and the Phase 1 server plumbing (env, Supabase clients, auth guard, document/upload/extract routes). No UI screens were built and nothing was applied or deployed.
**Options.** (a) Return to strict order: finish Phase 0 (label page, extraction of the 39, scoring) before any more Phase 1. (b) Run Phase 0 and Phase 1 in parallel; Phase 1 does not ship until the §13 thresholds pass.
**Recommendation.** (a) for the next session: build `/label` next, and have the photos made available to that session (D6).
**Decision:** (a) — owner, 2026-09-24. Build `/label` next.

