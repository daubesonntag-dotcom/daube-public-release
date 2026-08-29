# D’AUBE Facebook Reader — Public Validation Fixture

This fixture exists to validate the client-side privacy/permission contract and collect independent browser/device evidence for D’AUBE Facebook Reader.

Canonical implementation lane: `daubesonntag-dotcom/daube-provider-fabric#3`.
Canonical Facebook intake: `daubesonntag-dotcom/daube-business-os#362`.
Canonical independent tester/viewer intake: `daubesonntag-dotcom/daube-public-release#176`.

## What it does

The unpacked Manifest V3 extension runs only after an explicit click on the extension popup while a Facebook HTTPS tab is active. It captures a bounded research envelope from the visible DOM and surfaces candidate outbound links / GitHub repositories for later independent verification.

It does **not** ask for cookies, passwords, OTPs, Facebook tokens, `<all_urls>`, background crawling, messaging or account mutation.

## Five-minute volunteer pass

Use a Facebook post/reel/page that **you are already authorized to view** and that you are comfortable using for this test. Do not post the captured private body text publicly.

1. Download/clone this public repository and load `labs/facebook-reader-v1/extension/` via Chromium/Chrome **Load unpacked**.
2. Open your chosen Facebook page/post/reel.
3. Click the D’AUBE extension → **Capture current Facebook tab**.
4. Check whether the preview contains the expected source URL, useful visible text, outbound project/GitHub links and a sensible `reader_quality` value.
5. If safe to do so, test **Queue source URL in D’AUBE Radar**. Only source URL + bounded title should be transferred in the URL.
6. Report only public-safe observations to Issue #176: browser/version, OS/device, post/reel/page type, success/partial/blocker, and the first confusing or broken step.

Never paste passwords, cookies, tokens, private post text, account identifiers or screenshots containing sensitive/private information into a public issue.

## Evidence matrix for promotion

A green production claim requires all of these independently:

- **Static security contract:** exact permissions, bounded extraction, no credential/session-store access.
- **Functional browser fixture:** post + reel/video + outbound GitHub/project link.
- **Radar handoff:** source URL reaches the intake receiver without captured body text leaking into the URL.
- **Independent device evidence:** at least one bona fide external tester report; broader support should cover Chrome/Chromium variants and Android PWA sharing separately.
- **Rollback:** extension can be disabled/uninstalled and Radar lane can be feature-disabled without affecting canonical D’AUBE data.

## Quality score

Promotion score is evidence-weighted, not cosmetic:

- Security / least privilege: 30
- Deterministic contract verification: 25
- Real browser/device evidence: 20
- Provenance / canonical-upstream accuracy: 15
- Operability / rollback: 10

`>=95` is only awarded after evidence supports it. CI success alone cannot substitute for independent browser/device evidence.
