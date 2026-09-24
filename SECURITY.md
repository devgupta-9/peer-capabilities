# Security policy

Do not report a real credential in an issue, discussion, pull request, commit, or screenshot.

If a secret reaches GitHub, revoke and rotate it immediately; removing it from the latest commit is not sufficient. Then contact the repository owner privately with only the affected provider, file path, and commit identifier.

This repository must contain only secret-free templates and executable paths. Live Codex/Antigravity configs, authentication databases, environment values, cookies, tokens, Headroom state, logs, reports, and generated deployment state are excluded.

Before every commit and push, run:

```powershell
pwsh -NoProfile -File .\scripts\secret-scan.ps1 -Staged
```

The scanner uses high-confidence patterns and filename controls; it is defense in depth, not proof that a file is safe. Review the staged diff as well.
