# Cover-letter template

Selected [PFCS33/resume-cl-template](https://github.com/PFCS33/resume-cl-template) as the starting template for an optional cover letter alongside a tailored CV. This directory keeps the unchanged upstream source, its original compiled sample, and the application-owned adaptation used by the feature.

Open [the PDF preview](preview.pdf) or [the image preview](preview.png). Both contain upstream placeholder text, not a generated application letter.

## Source and license

The seven files in `upstream/` are unchanged downloads from commit [`d485ff56e1111d97f07acd0e9930be2a11d8c608`](https://github.com/PFCS33/resume-cl-template/tree/d485ff56e1111d97f07acd0e9930be2a11d8c608). The bundle includes only the cover-letter dependencies, README, and license. The upstream README also describes resume files that are intentionally not downloaded here.

The [MIT license](upstream/LICENSE) names Yunshan Feng, copyright 2025. It permits modification and redistribution with the copyright and permission notice retained. Upstream also acknowledges Jake Gutierrez's MIT-licensed resume template. The [ancestor notice](licenses/jake-resume-MIT.txt) is retained conservatively from [commit `3e64a933141a7cda3a328f0743f73a201628a4ba`](https://github.com/jakegut/resume/blob/3e64a933141a7cda3a328f0743f73a201628a4ba/LICENSE). This is a provenance record, not legal certification of every dependency.

[SHA256SUMS](SHA256SUMS) records the downloaded source and license hashes. Each download also matched its pinned upstream Git blob during acquisition.

## Selection

The selected template uses US Letter paper, pdfLaTeX, and a contact header similar in structure to the current CV. It separates the body, recipient fields, and shared header. It falls back to "Dear Hiring Manager," when the recipient name is empty. These properties make it a practical starting point without changing the app's compiler.

The other candidates were assessed from source and documentation, not locally compiled.

| Candidate | Reason not selected |
| --- | --- |
| [simpletexcv](https://github.com/lorenzosaino/simpletexcv/tree/f7ffa7cae69d834b878109cd15f823f3efb5c948) | MIT and pdfLaTeX-compatible by its Makefile, but its A4 sample has a taller postal-address header and differs more from the current CV. |
| [moderncv](https://www.ctan.org/pkg/moderncv?lang=en) | LPPL 1.3c and letter support, but adds a dedicated CV class instead of reusing an article-style layout. No local compiler compatibility claim is made. |
| [Awesome-CV](https://github.com/posquit0/Awesome-CV/tree/dfe863541ccc6ea624c48338a7ce550494530b31) | The inspected version requires LuaLaTeX with HarfBuzz and explicitly does not support pdfLaTeX. It does not fit the app's bundled engine. |

## Verification

Verified locally on Windows with the existing pinned TinyTeX toolchain on 2026-10-28.

- `node scripts/verify-latex.cjs` passed before downloading, with all 132 locked package records matching.
- The unchanged sample compiled twice with `--no-shell-escape` and `-halt-on-error`. No packages were installed.
- PDF.js confirmed one US Letter page, 612 by 792 points, with extractable name, role, generic greeting, and signature text.
- The log contained no overfull boxes. The compiler reported a `fancyhdr` warning that `\footskip` is too small. The footer is empty. The source remains unchanged, so the warning is retained rather than hidden.
- The rendered image was inspected. The header, letter body, and closing are visible without apparent clipping.

The upstream claim of ATS compatibility was not tested against a recruitment system. Physical network isolation was not tested. A successful placeholder sample does not prove that arbitrary generated content fits one page.

To check source hashes from this directory in Git Bash, run `sha256sum -c SHA256SUMS`.

To reproduce the preview from the repository root in Git Bash without writing into the downloaded source directory, run these commands. Use a new output directory for each run.

```bash
mkdir -p .audit/cover-letter-template-rebuild
cp -R resources/cover-letter-template/upstream/. .audit/cover-letter-template-rebuild/
cd .audit/cover-letter-template-rebuild/cover-letter
../../../.tools/latex/bin/windows/pdflatex.exe --no-shell-escape -interaction=nonstopmode -halt-on-error main.tex
../../../.tools/latex/bin/windows/pdflatex.exe --no-shell-escape -interaction=nonstopmode -halt-on-error main.tex
```

The result is `.audit/cover-letter-template-rebuild/cover-letter/main.pdf`. PDF metadata dates can make rebuilt PDF hashes differ. Compare the content and layout rather than expecting byte-identical PDFs.

## Application integration

The downloaded upstream files remain unchanged. The application-owned adaptation in `application/` uses Letter paper, Lato, and paragraph text. The source feature offers an unchecked include-letter choice before run authorization, separate document review and approval, a local optional recipient, actual PDF preview, and separate PDF/DOCX exports. A failed letter does not discard the saved CV.

The optional recipient is not sent to Pi and is never inferred from saved contacts. An empty value uses "Dear Hiring Manager,". Runtime compilation and required license resources are wired into the build configuration. No new installer has been built or installed for this change.

The focused visible Electron flow passed with a synthetic provider and real SQLite, compiler, PDF/DOCX output and file writes. See [visible-flow evidence](../../docs/validation/cover-letter-visible-flow.md) and [implemented workflows](../../docs/workflows.md). Real-provider and installed-app acceptance remain separate, unrun gates.

The designed workflow, baseline, compile logs, extracted text, and review evidence remain local under `.audit/cover-letter-template/`. The canonical decision trail is `docs/validation/optional-cover-letter-decisions.tsv`. Feature requirements are tracked in [issue #122](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/122).
