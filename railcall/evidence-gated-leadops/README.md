# D’AUBE Evidence-Gated LeadOps for RailCall

A RailCall module for governed Airtable lead operations. Read-only commands are declared `side_effects: none`; mutating commands are declared `side_effects: external`, so RailCall can stage, preview, require approval, execute, and issue signed receipts.

## Actions

`lead_search`, `lead_get`, `lead_dedupe_check`, `lead_create`, `lead_update`, `lead_qualify`, `lead_assign`, `lead_archive`, `audit_snapshot`.

## Security model

- Airtable credentials are read only through RailCall's injected `__rc_helpers__["vault_get"]` surface.
- The module declares sandbox egress only to `api.airtable.com`.
- Subprocess execution is disabled.
- Filesystem writes are disabled.
- No Airtable token is stored in source, module files, receipts, or test fixtures.
- Dedupe blocks lead creation on matching normalized email or phone by default.
- Archive requires a non-trivial explicit reason.
- `audit_snapshot` returns a deterministic SHA-256 digest of the fetched Airtable record.

## Setup

1. Install or update the official RailCall Station/CLI.
2. Configure an Airtable credential in RailCall's vault / Integrations surface under the provider key `airtable`. Use a personal access token scoped only to the test or intended base.
3. From this module directory, mint/register your publisher key as required by RailCall.
4. Sign the bundle: `railcall market module sign .`
5. Verify the bundle: `railcall market module verify .`
6. Copy/install the signed module into the Station modules directory and reload Modules.
7. Stage a read command and a write command through the RailCall airlock. Confirm write execution requires approval and produces a signed receipt.
8. Publish only after the clean-machine install test passes.

## Recommended smoke tests

- Search an existing synthetic lead.
- Run `lead_dedupe_check` for an email that occurs twice and confirm `duplicate: true`.
- Attempt `lead_create` with that duplicate identity and confirm the create is blocked.
- Qualify and assign a synthetic lead through airlock approval.
- Attempt archive with a short reason and confirm it is blocked before any API mutation.
- Archive with a valid reason through airlock approval.
- Fetch `audit_snapshot` and preserve the receipt hash as release evidence.

## Contest

`contest:round2`

Version: `0.1.1`
