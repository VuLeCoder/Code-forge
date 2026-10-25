# AGY local model setting

Use the project wrapper for future AGY CLI tasks so this repository consistently selects Gemini 3.8 Flash Medium:

```powershell
.\scripts\agy.ps1 -p "<bounded task prompt>" --print-timeout 120
```

The wrapper passes the supported model ID `gemini-3.8-flash-medium` to `agy.exe` on each invocation and rejects a conflicting `--model` argument. It reads the AGY executable from `PATH`; it stores no credentials and does not alter machine-wide AGY settings. The Codex AGY bridge currently exposes no model parameter, so bridge calls may continue to use that bridge's configured default; use the project wrapper when the exact Gemini 3.8 Flash selection must be enforced.

Keep AGY work bounded and read-only unless an exact implementation scope, isolated worktree, owned files, forbidden files, acceptance criteria, verification commands, and permission mode are recorded in a committed task plan. Never use permission bypass by default.
