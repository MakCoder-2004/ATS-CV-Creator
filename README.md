# CV Tailor

Personal Windows Workbench for managing local profile evidence (contact details, skills, experience, projects, education, certificates, summary, languages and extras), saved job postings, appearance, and OpenRouter API key and model ID preferences. Evidence changes are validated, versioned, and stored locally. A consent-bounded, source-linked draft can be generated, saved, checked, edited, measured for actual PDF page fit, and approved as an exact canonical document; approval and review state persist locally and reopen offline. Deterministic checks are limited and do not prove semantic truth. Approved CVs export as a selectable PDF or editable DOCX using the same canonical content; Word pagination may differ. The approved browser-only prototype remains under `prototypes/cv-tailor-ui/` as design evidence, never part of the installed app.

## Create a tailored CV

1. **Job posting:** add or open a saved role with its requirements.
2. **Outgoing data:** inspect the minimized posting and profile facts, then authorize that run.
3. **Generate:** the app analyzes the posting automatically. Review the required/preferred qualifications, tools, responsibilities and keywords, then generate the CV. Progress reflects actual operations, including local document measurement.
4. **Review evidence:** review the target headline, short summary, tailored experience and projects alongside their sources. Posting-only skill suggestions are labeled **Not in your profile**; confirm you have each skill or remove it. Confirmations apply to this CV only, do not change your profile, and do not establish that you used a tool in past work. Resolve findings, check page length and acknowledge the current wording before approval.
5. **Export:** save the approved single-column CV as PDF or Word. Review notices and pending/removed skill suggestions are never exported. Changes invalidate approval and require renewed review.

Existing saved drafts remain readable. Interrupted checkpoints created before the tailored-summary contract may require a fresh authorized generation rather than silently inventing missing narrative. Automated checks and a clean template are not proof of factual truth or a guaranteed ATS result.

## Develop and verify

```bash
npm ci                # Install once; no automatic full Electron native rebuild
npm run typecheck
npm test              # Rebuild SQLite for Node, then Vitest public application contract
npm run test:fast     # Repeat Vitest quickly while SQLite is still built for Node
npm run test:electron # Build and rebuild SQLite for Electron, then Playwright smoke
npm run dist:win      # Build a per-user NSIS installer in release/
```

`npm ci` no longer performs an eager Electron native rebuild on every install. `npm test` rebuilds the native database for Node; use `npm run test:fast` for later test runs only while SQLite still has the Node ABI. `npm run test:electron` rebuilds it for the installed Electron ABI (`npm run rebuild:electron` can do this explicitly); don't run the two suites concurrently against the same `node_modules`. Packaging still rebuilds native dependencies. After Electron tests, run `npm test` once before using `test:fast` again. The test override for temporary user data is disabled in packaged builds. The renderer has a narrow typed settings/profile/draft-review bridge, not generic IPC, Node or filesystem access. Editing explicitly declares wording-only or a new-fact path; new-fact edits must link current saved evidence. Semantic novelty cannot be perfectly detected, so this declaration and the deterministic checks are not a truth guarantee. Approval requires a freshly bound factual report, current cited sources, and a current measured page fit; accepted cuts clear the old report and approval. Settings and profile evidence are stored under Electron's per-user `userData` directory in `workbench.sqlite`.

The NSIS installer defaults to a per-user installation and lets you choose the location. The user confirms this current machine is a fresh Windows installation and accepts it for installer and release checks; a separate Windows VM is not required. Install the **actual installer**, confirm the first window opens, change appearance, close/reopen and confirm it persists through native SQLite. For release candidates, repeat this with an isolated app-data profile and verify the required export/recovery workflows; record exactly what was observed. The T01 installer was installed here, the installed executable passed an automated SQLite-backed reopen check with isolated temporary user data, and the user manually confirmed the installed app works. An unsigned personal installer can trigger SmartScreen or an unknown-publisher warning. It is not a signed public release; only run installers you trust. There is no bundled API key, Python runtime, model or personal sample profile.

The approved [specification](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/1) and implementation tickets define the scope. [Visual approval and handoff](prototypes/cv-tailor-ui/docs/HANDOFF.md) record the Workbench direction; the prototype is not a backend or an assurance of privacy.
