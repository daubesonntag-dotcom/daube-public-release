# D'AUBE Performance Autopilot release channel

This directory is the public, machine-readable update channel used by the local D'AUBE Performance Autopilot.

- `autopilot.ps1` — stable core.
- `manifest.json` — current version, download URL, and SHA-256.
- GitHub Actions validates PowerShell syntax and refreshes the manifest whenever the core changes.
- The Windows updater downloads to staging, verifies SHA-256 and PowerShell syntax, backs up the known-good core, performs a smoke test, and rolls back automatically if the new core fails.

The local supervisor keeps the running core separate from the release channel, so a bad release cannot overwrite the last known-good copy without passing validation and health checks.
