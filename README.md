# ATS CV Creator

Project workspace for ATS-friendly CV creation.

## UI prototype (before specification and tickets)

On branch `prototype/cv-tailor-ui`:

```bash
npm install
npm run prototype
```

Open http://127.0.0.1:5173/prototype?variant=A and compare A/B/C using the floating bar. Browser-only, memory-only, and no Gemini calls or real exports.

See [prototype instructions](prototypes/cv-tailor-ui/README.md), [discovery and stack handoff](prototypes/cv-tailor-ui/docs/HANDOFF.md), and [screenshot gallery](prototypes/cv-tailor-ui/docs/SCREENSHOTS.md). A — Workbench is the **approved UI direction**, including [light](http://127.0.0.1:5173/prototype?variant=A&mode=light) and [dark](http://127.0.0.1:5173/prototype?variant=A&mode=dark) modes and stronger Sora/Manrope typography. Approval is recorded in [prototype feedback](prototypes/cv-tailor-ui/docs/FEEDBACK.md).

## Specification

[CV Tailor specification — GitHub issue #1](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1), labeled `ready-for-agent`. Includes 86 user stories, the approved UI, implementation decisions, and the confirmed public-contract + Electron-smoke testing boundary. The approved breakdown is published as 22 native sub-issues (#2–#23); see [ticket navigation and blockers](prototypes/cv-tailor-ui/docs/TICKETS.md). The starting frontier is [#2 — Install and reopen the Workbench](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/2). Production implementation has not started.
