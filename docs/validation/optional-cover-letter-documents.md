# Optional cover-letter document adapters

This validation covers the isolated deterministic document adapter unit for issue #122. It does not cover generation, persistence, consent, approval, IPC, UI, packaged asset wiring, or destination writes. The owner of the later main integrator still needs to bind current contact and template identity, recheck approval and source guards at every boundary, and package these helpers without changing the existing CV contract.

## Implemented boundaries

`src/shared/cover-letter-document.ts` defines strict version-1 `CanonicalCoverLetter` and `CoverLetterTemplateIdentity` schemas. `projectCoverLetter(revisionInput, contactInput, templateInput)` accepts a strict `CoverLetterRevision`, current local sender contact, and verified template identity. It projects only printed wording and fields. Source citations and annotations do not enter the canonical artifact. Generic and named greetings are fixed by the projector. The shared module imports no Node crypto or filesystem APIs and restricts input to printable ASCII and Latin characters through U+024F. It normalizes decomposed Latin to NFC before hashing or rendering. Arabic and emoji fail closed.

`renderCoverLetterTex(input)` emits fixed `LetterName`, `LetterContact`, `LetterDate`, `LetterSubject`, `LetterGreeting`, `LetterBody`, and `LetterSignature` definitions. Every field is escaped once through the existing `escapeLatex`. Paragraph separators are renderer-owned `\\par` tokens. The verified application template and `assets.json` were not changed.

`src/main/cover-letter-compiler.ts` exports `createCoverLetterCompiler({ toolchainRoot, templateRoot, tempRoot })`. The returned API is `getTemplateIdentity(): Promise<CoverLetterTemplateIdentity>` and `compile(input): Promise<{ documentHash: string; pdf: Buffer; templateIdentity: CoverLetterTemplateIdentity }>`. `hashCoverLetterDocument(input)` hashes the strict canonical JSON, including template identity. Every call checks the exact pinned SHA-256 of `assets.json`, then verifies all 39 manifest entries before consulting the cache. The compiler uses fixed filenames, the pinned pdfLaTeX executable, an isolated temp/HOME/TEX environment, no shell escape, two 20-second passes, bounded output and a four-request dedupe/queue bound. Results are copied so callers cannot mutate cached bytes.

`src/main/cover-letter-pdf.ts` inspects actual PDF.js bytes and requires one selectable US Letter page, canonical field order, and every expected field. Compiler logs reject missing glyphs and significant overfull boxes. The DOCX adapter at `src/main/cover-letter-docx.ts` renders the same canonical letter as editable Lato paragraphs, with no citations or source annotations. Word pagination is not asserted to match PDF.

`src/main/cover-letter-compiler.ts` additionally copies the verified pinned `pdflatex.fmt` into the owned temporary TEXMFVAR. The manifest bytes themselves are pinned in compiler code so editing asset hashes cannot bless changed dependencies. The isolated 39-file compiler experiment exposed that the engine otherwise attempted `mktexfmt` when that private format path was empty. This keeps compilation offline and makes the verified manifest format file the one used by the run.

## Evidence

All fixtures and artifact content are synthetic. No user profile or application data was used. Actual compiler tests use the read-only `E:/cv-tailor-main/.tools/latex` root. Corruption tests copy the toolchain and app template into an owned temporary tree, then alter or remove copied DLL/font/template bytes only. The parent compiler files were not modified.

| Gate | Result |
| --- | --- |
| Focused adapters, existing letter contract, TeX, CV compiler/PDF, DOCX tests | `npx vitest run tests/cover-letter-document.test.ts tests/cover-letter-artifacts.test.ts tests/cover-letter-contract.test.ts tests/latex.test.ts tests/latex-pdf.test.ts tests/latex-compiler.test.ts tests/paragraph-compiled-pdf.test.ts tests/docx-export.test.ts --maxWorkers=1`: 37 passed, 3 skipped, 0 failed across 8 files. The two existing CV PDF suites skip because this isolated worktree has no local `.tools/latex`; actual letter PDF compilation ran against the explicit read-only toolchain root. |
| Legacy CV canonical/hash behavior | `npx vitest run tests/document.test.ts tests/document-metadata.test.ts tests/latex.test.ts tests/latex-compiler.test.ts tests/docx-export.test.ts --maxWorkers=1`: 36 passed, 1 skipped, 0 failed across 5 files. Existing legacy canonical hash fixtures passed. |
| Typecheck | `npm run typecheck`: passed. |
| Build | `npm run build`: passed. Vite emitted existing dependency annotation warnings for Zod; build completed. |
| Existing static layout harness | `node scripts/verify-cover-letter-layout.cjs --toolchain-root E:/cv-tailor-main/.tools/latex --module-root E:/cv-tailor-main`: passed. The harness remains unchanged. |
| Real adapter artifacts | Actual pdfLaTeX output was inspected with PDF.js for one 612 x 792 point page, selectable extended-Latin text, and expected order. DOCX ZIP bytes were inspected for the same canonical wording, Lato styles, subject, greeting, closing, and absence of citation source text. |
| Refusals and cache integrity | Actual compiler tests refused Arabic, emoji, long-recipient overflow, and a multipage body. Cold and warm-cache requests rejected altered and missing copied Lato font, `pdftex.dll`, and application template bytes. Traversal manifest paths were refused. Same-document concurrency returned independent safe buffers and left no owned temp workspaces. |

Detailed logs are in `.audit/cover-letter-documents/focused-final.log`, `legacy-cv-tests.log`, `typecheck-final.log`, `build-final.log`, and `layout-harness.log`. The artifact tests themselves remove generated PDFs, DOCX bytes, temporary compiler workspaces, and corruption copies.

## Integration API and remaining work

The main integration can use these exact APIs and types:

```ts
import { projectCoverLetter, renderCoverLetterTex } from '../shared/cover-letter-document'
import type { CanonicalCoverLetter, CoverLetterTemplateIdentity } from '../shared/cover-letter-document'
import { createCoverLetterCompiler } from './cover-letter-compiler'
import { inspectCoverLetterPdf, assertCoverLetterPdfContent } from './cover-letter-pdf'
import { renderCoverLetterDocx } from './cover-letter-docx'

const compiler = createCoverLetterCompiler({ toolchainRoot, templateRoot, tempRoot })
const templateIdentity: CoverLetterTemplateIdentity = await compiler.getTemplateIdentity()
const canonical: CanonicalCoverLetter = projectCoverLetter(revision, currentLocalContact, templateIdentity)
const pdf = await compiler.compile(canonical)
const docx = await renderCoverLetterDocx(canonical)
```

The main integration still owns loading current contact, setting package resource roots, calling these APIs behind trusted main-only paths, and checking the exact current revision/source/approval around preview, approval, export dialogs, and final writes. No call sites were added. No CV compiler, canonical CV document, PDF/DOCX CV adapter, `src/main/workbench.ts`, `src/main/index.ts`, preload, renderer, package manifest, storage, or consent files were changed. No full Node suite, Electron suite, packaged installation, or end-user workflow is claimed.
