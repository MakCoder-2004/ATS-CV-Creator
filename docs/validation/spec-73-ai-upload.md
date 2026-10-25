# AI-assisted CV upload implementation evidence

## U1 baseline frozen before feature changes

Commit `TBD` adds `tests/fixtures/profile-ai-upload-baseline.ts` and `tests/profile-ai-upload-baseline.test.ts`. The fixtures generate selectable-text PDF and DOCX bytes from fixed synthetic source text. They contain no personal CV data.

The straightforward PDF baseline locally maps Riley Example's contact details, TypeScript skill, Northwind Labs role, Atlas project, React technology and GitHub link. It leaves `UNKNOWN: Community mentor, dates not stated.` in unmapped review. The DOCX baseline locally maps the Northwind role and Atlas project, including its document hyperlink. It leaves the note with no role or date and the embedded instruction text unmapped.

The unusual PDF baseline contains an unrecognized career section, a Data Analyst role at Harbor Cooperative with dates and a supported report fact, a second ambiguous Harbor Cooperative role, and hostile document instructions. The current local mapper produces no experience record and retains these lines as unmapped. The frozen validator test supplies an exact, schema-valid candidate for the clear role and confirms that the current AI contract rejects it because there is no locally classified role to establish its kind. This demonstrates a source-contract gap. It is not a provider quality measurement.

The existing AI preview includes minimized unmapped text. It does not give that text a typed, application-owned source identity or a trusted role association. The model cannot safely turn the unclassified role into an experience proposal under the current validator. Existing source validation and local mapping tests remain in `tests/profile-ai-structuring.test.ts`, `tests/profile-pdf-import.test.ts` and `tests/profile-docx-intake.test.ts`.

**Provider baseline.** NOT VERIFIED. No real provider request ran. The implementation grant did not include run-specific authorization for a particular outgoing preview. Provider, model, effort, request count, elapsed time and correction count are therefore not reported.

**Installed baseline.** NOT VERIFIED. Installed verification belongs to child #81 and remains gated on user approval of the final executable.

## U1 focused checks

`node node_modules/vitest/vitest.mjs run tests/profile-ai-upload-baseline.test.ts tests/profile-ai-structuring.test.ts tests/profile-pdf-import.test.ts tests/profile-docx-intake.test.ts --maxWorkers=1` passed 4 files and 28 tests on Node 24.21.0. The initial baseline fixture run exposed two mistaken expectations about actual extracted date/link mapping. The fixtures were corrected to preserve observed local behavior before the baseline was frozen.

## Acceptance gates

- Synthetic PDF and DOCX source baselines are executable and fixed before feature code.
- Local mapped facts and unmapped text are distinguished from expected facts.
- Exact-citation, identity, ownership, unsupported-value, no-profile-mutation, single-consent and atomic-merge checks must pass before U2 is complete.
- Real-provider extraction and installed persistence remain NOT VERIFIED until child #81 is authorized and run under its required conditions.
