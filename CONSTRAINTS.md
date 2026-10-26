# Constraints

Last reviewed: 2026-10-26. This is a lightweight floor for the BTL/demo project; it intentionally adds no arbitrary coverage or performance targets.

## Always enforced

- No secrets, credentials, or `.env` values in source control, logs, or reports.
- No new test/lint/type suppressions, empty error-swallowing handlers, or unimplemented stubs.
- Do not skip/delete tests or weaken assertions, lint rules, type checks, or CI gates to make a change pass. Any intentional exception needs an explicit reason in the change record.
- Preserve user-owned and untracked files; never reset project data, database contents, Git storage, or Docker volumes as a shortcut.
- Do not claim a check passed unless it was run; distinguish local, CI, and cloud evidence.

## Verification source of truth

- Use the narrowest relevant package test/lint/typecheck during implementation.
- Before integration/release, use the existing `MVP verification` workflow in `.github/workflows/ci.yml`; do not duplicate its gates with new scripts or dependencies.
- Cloud migration/deploy requires confirmed target, readiness, and backup/recovery evidence. CI success alone does not satisfy this constraint.

## Changes to this bar

Keep this file floor-only unless the user asks for measurable quality budgets. Never relax an existing rule just to turn a failing check green.
