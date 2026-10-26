# Documentation map

Start with the [project README](../README.md) for the product and the [architecture map](architecture.md) for ownership. Use [implemented workflows](workflows.md) to trace a user action and [development and verification](development.md) to change or release the app. The [glossary](../GLOSSARY.md) fixes domain terms. Source code and tests decide current behavior when an older report disagrees with a guide.

## Current guidance

These files describe the current code or govern changes to it.

| Document | Use |
| --- | --- |
| [Root agent instructions](../AGENTS.md) | Project-specific agent rules and required reading. |
| [Project README](../README.md) | Product scope and a short setup and release summary. |
| [Glossary](../GLOSSARY.md) | Terms for career facts, posting sources, drafts, and approval. |
| [Architecture](architecture.md) | Electron boundaries, storage, model dispatch, and invariants. |
| [Implemented workflows](workflows.md) | Current shipped flows; see the installed Pi migration validation below. |
| [Develop and verify](development.md) | Setup, tests, native bindings, packaging, and installed Windows checks. |
| [Design system index](design-system.md) | Repository entry point for the UI contract. |
| [Design system](../design%20system/README.md) | Normative design reading order and prototype boundary. |
| [Visual tokens](../design%20system/tokens.md) | Colors, type, spacing, layout, and responsive measures. |
| [Page contracts](../design%20system/pages.md) | Page composition and which prototype sections apply. |
| [Interaction contract](../design%20system/interaction.md) | Feedback, accessibility, and interaction rules. |
| [Domain documentation rules](agents/domain.md) | How agents use the glossary and any future ADRs. |
| [Issue tracker rules](agents/issue-tracker.md) | GitHub issue conventions. |
| [Triage labels](agents/triage-labels.md) | Issue label meanings. |
| [Lato font notice](../resources/fonts/lato/README.md) | Font provenance. |
| [Pi SDK notices](../resources/licenses/README.md) | SDK license text and remaining redistribution review. |
| [LaTeX license inventory](../resources/latex-licenses/README.md) | Bundled toolchain license inventory and its limits. |
| [Spec 75 implementation evidence](validation/spec-75-implementation.md) | Focused paragraph-format checks and open provider and installed gates. |
| [Integrated spec fixes](validation/specs-integration-fixes.md) | Root causes, fixture corrections, and focused verification after the integrated Node test failures. |
| [Stage D temporary research integration](validation/universal-research-stage-d.md) | Development checks for reviewed source rights, full/provisional Pi analysis and remaining release gates; not installed-app proof. |
| [Integrated Settings follow-up](validation/settings-followup.md) | Combined two-card Settings, legacy finding/recovery and Tavily key development checks; see the separate installed observations below. |
| [Optional faithfulness removal](validation/remove-faithfulness.md) | Earlier branch-specific development evidence for Settings simplification, old preference cleanup and paused-run compatibility. |
| [Tavily key card](validation/tavily-key-card.md) | Earlier pre-merge development evidence; screenshots there still show the removed cards. |

Tailor CV and Saved jobs follow the approved Variant A visual direction. My profile and Settings keep their implemented structures. The design system is normative for UI decisions, but the prototype does not prove a feature ships. Read the relevant design contracts before renderer work.

## Current feasibility research

These reports record source-access decisions that are not shipped product behavior.

| Document | Scope |
| --- | --- |
| [LinkedIn job intake feasibility](research/linkedin-job-intake-feasibility-2026-10-25.md) | Bounded research on approved single-job read routes; no suitable route was verified. |
| [Job-posting source access and retention gates](research/source-access-retention-gates-2026-10-26.md) | Official-source access and save/retention statuses for LinkedIn, Indeed, Greenhouse, and Lever; no source currently passes both gates. |
| [Issue 95 Pi Web Access prototype](validation/issue-95-pi-web-access-prototype.md) | Isolated pinned extension/MCP proof is explicitly STOP; stubbed search works, but cache lifecycle, usable live provider, auth, packaging, and installed gates remain open. |

## Historical research and feasibility

These documents record earlier questions, proposals, and experiments. They are not a backlog of installed features or a replacement for checking code.

| Document | Scope |
| --- | --- |
| [AI job-search adoption plan](research/ai-job-search-adoption-plan.md) | Proposed future capabilities and dependencies, not a shipped product map. |
| [Upstream AI job-search audit](research/ai-job-search-source-audit.md) | External repository inspection and reuse limits. |
| [Egypt and MENA discovery](research/egypt-mena-job-discovery.md) | Source and compliance research, not an enabled feed. |
| [LaTeX PDF compilation](research/latex-pdf-compilation.md) | Compiler options, experiments, and provisioning history. |
| [Link import feasibility](research/link-import-feasibility-2026-10-22.md) | Pre-release source and resource feasibility findings. |
| [CV upload feasibility](feasibility/cv-upload-39.md) | Earlier import prototype and decision gate. |

## Historical validation

These reports record tests, artifacts, and claims at the stated version or issue. Keep them for traceability, but do not copy a past result into a current release claim.

| Document | Scope |
| --- | --- |
| [CV creation flow](validation/cv-creation-flow.md) | v0.1.1 implementation; its Arial, headline, and summary output was superseded by v0.2.0. |
| [CV metadata layout](validation/cv-metadata-layout.md) | v0.2.1 metadata layout and installation. |
| [CV upload installed workflow](validation/cv-upload-installed-workflow.md) | Installed-app profile import release gate. |
| [LaTeX export](validation/latex-export.md) | v0.2.0 supplied-template and installed-export checks. |
| [Link release](validation/link-11-release-2026-10-22.md) | Bounded Lever intake release checks and limits. |
| [Review workspace](validation/review-workspace.md) | v0.3.0 review, manual records, and qualification comparison. |
| [Pi migration baseline](validation/pi-sdk-baseline.md) | Pre-change Settings screenshots, offline model-work checks, and installed SQLite reopen for issue #64. |
| [Installed Pi SDK proof](validation/pi-sdk-proof.md) | Tool-free request, local auth failures, and cancellation from installed Electron for issue #65. |
| [Installed Pi migration 0.4.0](validation/pi-sdk-installed-0.4.0.md) | Real provider CV, regeneration, faithfulness, old-PDF/DOCX proposals, login gates, backup/reopen, and Settings screenshots. |
| [Job deletion D1, D2, and D3](validation/spec-72-implementation.md) | Synthetic backend and visible UI checks pass. Installed acceptance remains pending user executable approval. |
| [Version 0.5.0 integration and build](validation/specs-integration-0.5.0.md) | Reviewed spec integration, 345 passing tests, four integrated development Electron cases and a statically checked installer. Installed and real-provider gates remain open. |
| [Version 0.6.0 job-link research](validation/universal-research-0.6.0.md) | Reviewed temporary public-link intake, scoped consented analysis, focused development checks and an unsigned installer checked statically. Installed and real-provider acceptance remain open under #89. |
| [Installed Settings 0.6.1](validation/settings-installed-0.6.1.md) | Actual per-user installation, isolated SQLite reopen and two-card layout checks; encrypted-key/clipboard, legacy semantic and real-provider gates remain open. |
| [Installed PDF and search safety 0.6.2](validation/installed-pdf-tavily-safety-0.6.2.md) | Actual per-user installation, isolated native SQLite reopen and synthetic PDF/DOCX export; user-approved unpacked PDF layout, with real Pi/Tavily and key/recovery gates still open. |
| [Issue 94 link-intake and authorization baseline](validation/issue-94-link-intake-authorization-baseline.md) | Synthetic visible and domain-test evidence for direct/manual intake, research, consent, profile import and paragraph regeneration; the visible Tavily search uses a fake key/transport, and no live-provider behavior or fixed Tailor CV graph-call totals are claimed. |

## Prototype design evidence

[`prototypes/cv-tailor-ui/`](../prototypes/cv-tailor-ui/README.md) is a browser-only exploration, not the production renderer or persistence layer. Keep its approval history when changing the normative Tailor CV or Saved jobs design.

- [Prototype README](../prototypes/cv-tailor-ui/README.md) describes how to inspect it.
- [CV flow preview](../prototypes/cv-tailor-ui/CV-FLOW-PREVIEW.md) records a throwaway interaction exploration.
- [Design notes](../prototypes/cv-tailor-ui/docs/DESIGN.md), [feedback](../prototypes/cv-tailor-ui/docs/FEEDBACK.md), and [inspection record](../prototypes/cv-tailor-ui/docs/INSPECTION.md) record earlier design choices and checks.
- [Screenshots](../prototypes/cv-tailor-ui/docs/SCREENSHOTS.md), [handoff](../prototypes/cv-tailor-ui/docs/HANDOFF.md), and [ticket index](../prototypes/cv-tailor-ui/docs/TICKETS.md) retain visual evidence and publication context.

## Keep this map current

When a feature ships, update the relevant current workflow and architecture section, then cite the code or test that establishes the change. If a new result supersedes a validation report, leave the dated report intact and label it historical. Record a new release observation separately. Do not remove an older document merely because its behavior changed; remove one only after checking its unique evidence and incoming links. Run `node scripts/check-doc-links.cjs` after edits. The script checks local targets, not anchors or external websites.
