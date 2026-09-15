# ADR 0003 — Reuse the Timesheet App's qbXML / Web Connector service

**Status:** accepted, 2026-09-15

## Context
A robust qbXML interface via QuickBooks Web Connector already exists in the Synergie Timesheet App and runs on an always-on machine. The store will use a separate QuickBooks company file (and possibly a separate machine).

## Decision
PaperFlow does not implement qbXML or SOAP. It produces canonical JSON requests in the `qb_sync` table (SPEC §9, typed in `src/lib/contracts/qb.ts`). The existing service gets a second connector configuration pointing at the store company file plus a thin adapter that consumes `qb_sync` rows, renders qbXML, submits, and writes back TxnIDs and errors.

## Consequences
The QB leg is the last phase and the only one that needs the QB machine. Everything upstream is testable with QB absent. The canonical payload, not qbXML, is the contract between the two systems; golden JSON files in `fixtures/golden/` pin it.
