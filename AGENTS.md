## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.

For installer validation or release checks, use the user's confirmed fresh Windows machine as the accepted Windows test environment. A separate VM is not required; still verify the real installed app, native SQLite and reopen behavior. See the environment decision in issue #1.

### Triage labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo; read the root `GLOSSARY.md` and relevant ADRs under `docs/adr/` when present. See `docs/agents/domain.md`.
