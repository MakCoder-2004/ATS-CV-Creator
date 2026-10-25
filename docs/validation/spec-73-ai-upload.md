# AI-assisted CV upload implementation evidence

## U1 pre-change baseline

Commit `e7370cb04ed99401aa56c601b6e2d44c68af2b30` added repeatable synthetic PDF and DOCX fixtures in `tests/fixtures/profile-ai-upload-baseline.ts` and executable baseline cases in `tests/profile-ai-upload-baseline.test.ts`. The fixtures contain no personal CV data.

The straightforward PDF baseline locally maps Riley Example's contact details, TypeScript skill, Northwind Labs role, Atlas project, React technology and GitHub link. It leaves `UNKNOWN: Community mentor, dates not stated.` unmapped. The DOCX baseline locally maps the Northwind role and Atlas project, including the document hyperlink. It leaves a note with no role or date and embedded instruction text unmapped.

The unusual PDF contains a Data Analyst role at Harbor Cooperative, dates, a supported report fact, a second ambiguous role for the same employer, a linked report, repeated Atlas project names and hostile document instructions. The unchanged local mapper produces no experience record for this layout. Its exact candidate role is rejected by the pre-change AI validator because no locally classified role establishes its kind. This demonstrates a source-contract gap, not a model-quality result.

After U2 work began, the fixture suite gained extra assertions for repeated project names and app-bound link evidence. These additions supplement the original baseline commit. The PDF/DOCX extractors and deterministic mapper were not changed. The added assertions record those paths against the unchanged mapper.

The current AI preview already sends minimized mapped and unmapped text. The missing capability was a typed, application-issued source identity and position for all readable text, plus validation that can admit a new unresolved role without trusting model-issued evidence or parent IDs.

**Provider baseline.** NOT VERIFIED. No real provider request ran. The implementation grant did not include run-specific consent for an outgoing preview. Provider, model, effort, request count, elapsed time and correction count are not reported.

**Installed baseline.** NOT VERIFIED. Child #81 requires installed validation and remains open. The final executable has not been approved or tested.

## Chosen evidence contract

The existing deterministic mapper remains the local first pass. A separate `ProfileSourceEvidenceDocument` records the captured document hash, format, exact page text and ordered source passages. Each passage has an application-issued page-and-position locator, exact offsets, source text and only the hyperlinks attached to that passage. PDF units follow extracted line order. DOCX units follow paragraph order. Long passages are split at exact offsets; source-unit overflow refuses AI preparation rather than dropping text.

The outgoing preview shows readable minimized source text and page/passage locators rather than raw JSON or random internal IDs. The model can cite only supplied locators. It cannot provide page values, quotations, fields or persistent proposal IDs. The app resolves each citation against the frozen evidence, creates exact proposal source records, validates each proposed value and issues persistent identities itself. The validator requires every source passage to be either cited or retained as unresolved. Unknown role kinds stay unresolved. A nested fact must follow its role or project evidence without an intervening unassigned source passage, and it must precede the next proposed parent. A hyperlink without a paragraph or line anchor stays unresolved. Ambiguous associations remain for correction or skip.

The alternative was to add more deterministic recognition rules and classify the resulting passages before AI. That would preserve the local mapper's current ownership model, but it would still hide readable text from new role proposals. The evidence document was selected because it makes the extraction source, position, hyperlinks and exact support explicit without broadening local parsing or trusting model-created evidence. The cost is a strict output-coverage requirement and conservative rejection when parent order is ambiguous.

## U2 focused verification

`node node_modules/typescript/bin/tsc --noEmit` passed after the source-evidence, validator, IPC and renderer changes.

`node node_modules/vitest/vitest.mjs run tests/profile-ai-upload-baseline.test.ts tests/profile-source-evidence.test.ts tests/profile-ai-structuring.test.ts tests/profile-pdf-import.test.ts tests/profile-docx-intake.test.ts --maxWorkers=1` passed 5 files and 35 tests. The tests cover exact PDF/DOCX evidence spans, page and paragraph ordering, attached and unanchored links, source-unit limits, foreign citation IDs, unsupported values, omissions, unresolved role kinds and a nested fact moved across role anchors. Existing PDF and DOCX intake and mapper cases also passed.

`node scripts/check-doc-links.cjs` reported that local links resolve in 42 Markdown files.

The focused Electron profile-import and AI suites were not run. The coordinator owns the final build and integration verification. Electron visible-flow, empty-profile, existing-profile merge, reopened persistence, provider fault matrix and responsive behavior therefore remain NOT VERIFIED in this worktree. Updated acceptance tests are present but have not been executed.

## Acceptance matrix

| Gate | Implementation or evidence | Result |
| --- | --- | --- |
| Local PDF/DOCX extraction and local-only review | Existing bounded intake workers and unchanged mapper; synthetic fixtures | Focused unit checks passed; visible Electron route NOT VERIFIED |
| Complete authorized source text, exact locators and links | `src/shared/profile-source-evidence.ts`; exact-span and paragraph/link tests | Focused unit checks passed |
| Correct source support, application IDs and nested parent order | `materializeProfileAiResult` and validator tests | Focused unit checks passed for tested cases; full hostile fixture/provider matrix NOT VERIFIED |
| No request before explicit consent, one dispatch, frozen model/effort | Existing import IPC lifecycle plus updated scripted Electron tests | NOT VERIFIED in Electron |
| Malformed output, provider failure, timeout and cancellation | Sanitized IPC results, retained local proposals, existing cancellation path | NOT VERIFIED in Electron |
| Profile edit, stale baseline rebase, invalid merge target and atomic storage behavior | Existing transactional merge plus explicit refresh-merge-choices route | NOT VERIFIED in Electron or on reopened SQLite |
| Empty-profile and existing-profile user completion | Existing reviewed proposal UI and merge actions | NOT VERIFIED in Electron |
| Real Pi output quality and physical provider count | No run-specific outgoing-data consent | NOT VERIFIED; no provider call was made |
| Installed native SQLite and reopen behavior | Requires child #81 and final executable approval | NOT VERIFIED; gate remains open |

No full test suite, package, installer, packaged executable or real provider was run. No issues were closed or retargeted.
