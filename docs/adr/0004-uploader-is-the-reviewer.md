# ADR 0004 — The uploader confirms at capture time; the owner sees exceptions only

**Status:** accepted, 2026-09-15

## Context
An accountant reviewing weeks later is slow, expensive, and has less information than the employee holding the paper. The owner wants no accountant role.

## Decision
Every document is confirmed by the person who captured it, within seconds, on a card that highlights low-confidence fields. Their corrections train the vendor alias table. Only rule failures (SPEC §8 exception codes) reach the owner. QuickBooks push is approval-gated until the owner flips `auto_push_enabled` (SPEC §11).

## Consequences
The confirm card is the most important screen in the product; keep it to one thumb and under 15 seconds for the common case. Accuracy thresholds (SPEC §13) exist to keep the card fast, not to replace it.
