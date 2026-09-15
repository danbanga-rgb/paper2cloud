# ADR 0001 — Own PWA instead of any WhatsApp integration

**Status:** accepted, 2026-09-15

## Context
Paper is currently photographed into a WhatsApp group. The official WhatsApp Cloud API supports groups only for business-created groups with ≤ 8 members and an Official Business Account; unofficial linked-device libraries carry ban risk and protocol churn.

## Decision
Build our own installable web app (PWA) for iPhone with direct camera capture. WhatsApp remains for human chat only and is not integrated in any form. A one-time WhatsApp *export* importer exists solely to build the Phase 0 fixture set.

## Consequences
Full control over capture UX, immediate feedback to the uploader, per-user accountability, no third-party messaging dependency. Cost: staff must adopt a new app; mitigated by three big buttons and a confirm card that takes seconds.
