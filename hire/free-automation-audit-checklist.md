# Free Automation Audit Checklist — D’AUBE SONNTAG

Use this before paying anyone to repair or expand an automation.

## Quick Check
- What business event triggers the workflow?
- Which systems does it read from and write to?
- Who owns the workflow?
- Where are credentials stored?
- What happens when authentication expires?
- Can the same event run twice? If yes, is the workflow idempotent?
- What happens on a timeout, 429, 4xx or 5xx response?
- Is there a retry ceiling?
- Is there a dead-letter or manual recovery path?
- Are sensitive values redacted from logs?
- Is timezone/scheduling behavior explicit?
- Can a partial write leave systems inconsistent?
- Is there a rollback or reconciliation process?
- Are success/failure events observable?
- Is there a reproducible test fixture?
- Are acceptance criteria written down?

## Red Flags
Treat these as high priority: silent failures, duplicate billing/messages, leaked secrets, uncontrolled retries, production writes without validation, missing ownership, and “works on my machine” with no reproducible evidence.

## Minimum Handoff
Ask for: architecture summary, configuration list, credential boundary, runbook, known limitations, monitoring, recovery steps, test evidence and acceptance criteria.

Need a deeper audit? D’AUBE offers a bounded Automation Rescue service at `/hire/` or via hello@daubesonntag.com.