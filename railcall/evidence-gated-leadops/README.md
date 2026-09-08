# D’AUBE Evidence-Gated LeadOps for RailCall

A RailCall module for governed Airtable lead operations. Reads are direct; writes are declared `side_effects: external` so RailCall stages, previews, requires approval, executes, and emits signed receipts.

## Actions
`lead_search`, `lead_get`, `lead_dedupe_check`, `lead_create`, `lead_update`, `lead_qualify`, `lead_assign`, `lead_archive`, `audit_snapshot`.

## Install
1. Install RailCall CLI.
2. Set `AIRTABLE_API_KEY` to an Airtable personal access token with access only to the intended base.
3. Sign: `railcall market module sign .`
4. Verify: `railcall market module verify .`
5. Copy/install into RailCall station and reload Modules.

## Safety
- Dedupe guard blocks creates matching email/phone by default.
- Archive requires an explicit non-trivial reason.
- No secret is stored in module files; API token comes from environment.
- All mutating commands declare external side effects for RailCall approval gating.
- `audit_snapshot` returns a deterministic SHA-256 digest of the fetched record.

## Contest
`contest:round2`
