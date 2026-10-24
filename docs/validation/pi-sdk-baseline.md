# Model migration baseline for issue #64

This is a pre-change record from the 0.3.0 OpenRouter application. The [migration spec](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/63) defines the intended Pi behavior. These results do not prove Pi authentication or dispatch.

## Reproduce the observed app behavior

From a checkout of this commit with physical dependencies for packaging, run the following commands. Run Node tests before rebuilding SQLite for Electron. The screenshot command creates an isolated workspace and never uses the person's saved records.

```bash
npm run typecheck
npm rebuild better-sqlite3 --no-audit --no-fund
npx vitest run tests/pi-migration-baseline.test.ts tests/analysis-workbench.test.ts tests/outbound-consent.test.ts tests/source-linked-generation.test.ts tests/generation-recovery.test.ts tests/profile-pdf-import.test.ts
npm run build
npm run rebuild:electron
npx playwright test tests/electron/openrouter-settings.spec.ts tests/electron/outbound-consent.spec.ts tests/electron/analysis-run-scope.spec.ts
node scripts/capture-settings-baseline.cjs
CV_TAILOR_INSTALLED_EXE="<genuinely installed CV Tailor.exe>" npx playwright test tests/electron/installed.spec.ts --grep 'installed app opens and writes SQLite'
node scripts/capture-settings-baseline.cjs "<genuinely installed CV Tailor.exe>"
```

On the baseline machine, typecheck passed. Six focused Vitest files passed 46 tests, including the new absent-credential check. The three Electron specs passed four tests. The real installed 0.3.0 executable passed the SQLite reopen test. The screenshot script opened, closed, and reopened both source and installed apps with separate temporary user data. It saved four views per app and verified SQLite creation, persisted appearance, and persisted model preference. No provider request or private CV data was used. The image bytes matched for each source and installed view at the same theme and width.

[Source and installed Settings images](pi-sdk-baseline/) record light and dark views at 1440 and 375 pixels. The 1440-pixel layout has model and API-key blocks side by side, followed by faithfulness, local budgets, and backup. At 375 pixels these blocks stack without page-level overflow. Preserve this structure when replacing the model and credential sections. The images contain only fresh-workspace defaults.

## Compare old and intended behavior

| Operation | Observed baseline | Pi migration check |
| --- | --- | --- |
| Settings and reopen | A default OpenRouter ID and local budgets persist. A missing app key remains unsaved. | Require an explicit Pi model and supported effort. Do not restore an OpenRouter ID, quota, or key. Persist the new selection across reopen. |
| Outgoing-data preview | A fresh run requires acknowledgement. Without an app key, analysis fails before HTTP. | Keep fresh consent. A missing Pi login, unavailable model, or unsupported effort must fail before dispatch. |
| Posting analysis and cache | A new run must call `startAnalysis` before generation, even when compatible cached analysis exists. Posting and profile edits stale consent. | Include model and effort in cache scope. Never promote a cache hit into new-run authorization. |
| Generation and review | Source-linked tests enforce citation parents, bounded repair, cancellation, and retained saved facts. | Route scoring, wording, repair, faithfulness, and regeneration through Pi without weakening evidence or export checks. |
| Interrupted generation | Current recovery can resume a frozen OpenRouter run or request an explicit duplicate-risk decision. | Preserve readable drafts and history. Old uncertain runs cannot resume under Pi and need new preview, consent, and analysis. |
| PDF and DOCX import | Local extraction works independently. Optional AI needs separate text preview and consent; proposals need explicit apply. | Keep local extraction, use Pi with the frozen model and effort, and discard late or unsupported proposals. |

`tests/fixtures/pi-migration-gates.json` holds synthetic model and provider-response cases for the later dispatcher tests. Registered providers overlap deliberately, and one model ID contains a slash. No future-model test is reported as passing now. The tests for model lookup, effort, authentication, output stop reasons, and legacy non-resumption belong at the public dispatch and migration interfaces introduced by issues #65 through #69. Existing `tests/analysis-workbench.test.ts`, `tests/source-linked-generation.test.ts`, `tests/generation-recovery.test.ts`, and `tests/electron/profile-ai-safety.spec.ts` already exercise the remaining current negative behaviors. Re-run these cases after changing each boundary.

Stop dependent work if the SDK cannot load in installed Electron, a synthetic credential reaches renderer or logs, a locally invalid selection triggers provider traffic, an old interrupted run resumes under Pi, or a real installed-app test is inconclusive. An unpacked binary does not satisfy the installed gate.
