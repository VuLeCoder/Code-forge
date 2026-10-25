# AGY local model setting

Use the project wrapper for future AGY CLI tasks so this repository consistently selects Gemini 3.8 Flash Low, the model variant that passed a local prompt smoke test on 2026-10-25:

```powershell
.\scripts\agy.ps1 -p "<bounded task prompt>" --print-timeout 120s
```

The CLI currently lists Gemini 4 Argon (Low/Medium/High), Gemini 3.8 Flash (Low/Medium/High), Claude Opus 5.5 (Low/Medium/High), Claude Sonnet 5.5 (Low/Medium/High), and GPT-OSS 120B (Medium). A prior 120-second repository audit with Gemini 3.8 Flash Medium timed out without usable output; a no-tools smoke prompt using Gemini 3.8 Flash Low returned the expected response. The wrapper passes `gemini-3.8-flash-low` to `agy.exe` on each invocation and rejects a conflicting `--model` argument. The wrapper reads the AGY executable from `PATH`; it stores no credentials and does not alter machine-wide AGY settings. The Codex AGY bridge currently exposes no model parameter, so use the wrapper when the exact tested model must be enforced.

A read-only local AGY request was first denied because it required MCP. The user then explicitly authorized MCP use so AGY could work. A single read-only audit was retried in a dedicated temporary worktree with MCP available for that exact task; it timed out at 120 seconds and produced no usable result. The temporary checkout was clean and removed. No persistent allow-rule, wildcard, global permission bypass, or Windows/Antigravity security setting was added or changed. The model wrapper works independently of MCP permissions.

Keep AGY work bounded and read-only unless an exact implementation scope, isolated worktree, owned files, forbidden files, acceptance criteria, verification commands, and permission mode are recorded in a committed task plan. Never use permission bypass by default.
