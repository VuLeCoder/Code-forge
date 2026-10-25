# AGY local model setting

Use the project wrapper for future AGY CLI tasks so this repository consistently selects Gemini 3.8 Flash Medium:

```powershell
.\scripts\agy.ps1 -p "<bounded task prompt>" --print-timeout 120s
```

The wrapper passes the supported model ID `gemini-3.8-flash-medium` to `agy.exe` on each invocation and rejects a conflicting `--model` argument. The Antigravity IDE window also showed Gemini 3.8 Flash Medium as its selected model when inspected on 2026-10-25. The wrapper reads the AGY executable from `PATH`; it stores no credentials and does not alter machine-wide AGY settings. The Codex AGY bridge currently exposes no model parameter, so bridge calls may continue to use that bridge's configured default; use the project wrapper when the exact Gemini 3.8 Flash selection must be enforced.

A read-only local AGY request was first denied because it required MCP. The user then explicitly authorized MCP use so AGY could work. A single read-only audit was retried in a dedicated temporary worktree with MCP available for that exact task; it timed out at 120 seconds and produced no usable result. The temporary checkout was clean and removed. No persistent allow-rule, wildcard, global permission bypass, or Windows/Antigravity security setting was added or changed. The model wrapper works independently of MCP permissions.

Keep AGY work bounded and read-only unless an exact implementation scope, isolated worktree, owned files, forbidden files, acceptance criteria, verification commands, and permission mode are recorded in a committed task plan. Never use permission bypass by default.
