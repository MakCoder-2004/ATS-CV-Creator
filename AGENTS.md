## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.

For installer validation or release checks, use the user's confirmed fresh Windows machine as the accepted Windows test environment. A separate VM is not required; still verify the real installed app, native SQLite and reopen behavior. See the environment decision in issue #1.

### Triage labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo; read the root `GLOSSARY.md` and relevant ADRs under `docs/adr/` when present. See `docs/agents/domain.md`. Start at `docs/README.md` for current architecture, shipped workflows, development checks, and the status of older research and validation. Use source and tests to resolve conflicts with historical reports. When shipped behavior changes, update the relevant current guide and keep dated validation reports as historical evidence.

### Frontend design system

Before any renderer UI design, implementation, or review, read `design system/README.md` and the relevant contracts in `design system/`. Those documents are normative: Tailor CV and Saved jobs follow the approved Variant A prototype; My profile and Settings preserve their implemented structure. Use `docs/design-system.md` as the index; update the system when intentionally changing a shared visual or interaction rule.
