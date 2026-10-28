# Cover-letter layout artifact validation

This is a standalone template experiment for [issue #122](https://github.com/MakCoder-2004/ATS-CV-Creator/issues/122). The artifact checks below passed. They do not establish application integration, runtime cache enforcement, installed behavior, or real-provider correctness.

## Fixed content contract

`resources/cover-letter-template/application/cover-letter.tex` includes the fixed filename `content.tex`. Main must generate that file from locally held canonical fields. The only content macros are `\LetterName`, `\LetterContact`, `\LetterDate`, `\LetterSubject`, `\LetterGreeting`, `\LetterBody`, and `\LetterSignature`.

Escape every field once in the trusted renderer. Body paragraphs are separated by application-owned `\par` commands. Content cannot choose filenames, paths, macro names, or executable TeX. The fixed template also terminates the body with `\par`, so the closing cannot run into the final paragraph when a renderer omits a trailing paragraph command.

The template uses US Letter, Lato, T1 encoding, `glyphtounicode`, and `\pdfgentounicode=1`. The sender header is centered. Date, subject, salutation, body, closing, and signature are left-aligned. The date is an input, not `\today`. The generic greeting is `Dear Hiring Manager,`. The layout is an application-owned adaptation, not a claim of pixel parity with the upstream serif sample.

## Reproduce the artifact gate

From a fully provisioned checkout, run `node scripts/verify-cover-letter-layout.cjs`. The script needs the existing PDF.js and canvas dependencies and the pinned `.tools/latex` tree. It does not use Poppler or install packages.

For the isolated template worktree, verification used these explicit read-only roots.

```bash
node scripts/verify-cover-letter-layout.cjs --toolchain-root E:/cv-tailor-main/.tools/latex --module-root E:/cv-tailor-main
```

The script creates unique output folders under its own `.audit/cover-letter-layout/`. It copies only app-owned template and synthetic fixture content, uses isolated HOME/TEXMF state, filters TeX-related environment variables, invokes fixed pdfLaTeX twice with `-no-shell-escape`, and caps each process at 20 seconds with bounded output. It does not claim OS-level network isolation.

The fixture is a synthetic paragraph letter, not generated career evidence. These results therefore test layout and artifact handling, not factual generation.

| Check | Observed result |
| --- | --- |
| Generic greeting | VERIFIED, one 612 by 792 point page, expected selectable text in order. |
| Named greeting | VERIFIED, same page size/count and expected local name in salutation. |
| Fonts | VERIFIED through PDF.js decoded font objects, with embedded nonempty Lato-Regular and Lato-Bold programs and no system font fallback. |
| Escaped input | VERIFIED, accented Latin and literal `&`, `%`, `_`, braces, `#`, dollar, tilde, caret, vertical bar, angle brackets, and TeX-looking `\input{sentinel.txt}` extract as text. The sentinel file exists during compilation, but its secret text is absent from the PDF. This does not replace testing the later application's escaping function. |
| Long recipient | VERIFIED negative, actual overfull output is detected and refused. |
| Long body | VERIFIED negative, the actual PDF exceeds one page and is refused. |
| Unsupported Arabic glyph | VERIFIED negative, compilation reports the actual unsupported Unicode character rather than an unrelated process failure. Arabic layout is not supported by this Latin template. |
| Closing and signature | VERIFIED, separate left-aligned lines. A first visual inspection caught the closing appended to the final body line; the template was corrected and this now has an explicit artifact assertion. |
| Visual inspection | VERIFIED, parent inspected the final rendered generic page and the escaped-text page. No apparent clipping in the accepted samples. |
| Required asset manifest | VERIFIED, 39 root-relative application/toolchain files captured from successful generic/named/extended-Latin recorder closures, toolchain metadata, and recursive normal/delay PE imports of the native compiler. |
| Corruption probes | VERIFIED, the manifest verifier rejects altered template/font bytes and altered or missing `pdftex.dll` and `msvcr100.dll` in owned asset copies. Shared compiler assets were not changed. |

The final harness was run repeatedly without recording a new manifest; the observed closure matched the pinned file. The final `.audit/cover-letter-layout/summary.json` records concrete output folders, page geometry, embedded fonts, and negative outcomes. Sources and license hashes in the downloaded upstream bundle remain unchanged.

## Initial failures and corrections

The first worker included unavailable `microtype.sty`; it was unnecessary and removed. Its next inspection depended on absent Poppler tools, so that incomplete result was not accepted. Parent replaced the inspection with existing PDF.js/canvas. A raw-PDF font-name probe was also rejected because compressed object streams concealed those dictionaries; decoded PDF.js font objects now establish embedding. Inspection and cleanup operate on the actual PDF loading task.

The parent also corrected test-input Unicode literals and the closing's paragraph boundary before accepting the gate. None of those earlier runs is represented as a pass.

## Runtime manifest and integration boundary

`application/assets.json` has `schemaVersion: 1`, fixed `entry` and `contentFilename`, and an `assets` array. Every entry has `root` of `application` or `toolchain`, a contained slash-separated relative `path`, and SHA-256 of exact bytes. The application template is LF-pinned for stable checkout bytes.

The first independent review rejected the 37-file inventory because the TeX recorder cannot see OS-loaded DLLs. The corrected inventory adds `pdftex.dll`, which contains the actual engine, and its supplied `msvcr100.dll`. The verifier recursively reads normal and delay import tables of the pinned executable and non-system dependencies. It fails on an unknown non-system dependency rather than assuming it is installed. `systemDependencies` explicitly lists `advapi32.dll`, `kernel32.dll`, `shell32.dll`, and `user32.dll` as Windows-owned dependencies, not bundled or hash-pinned application assets. This is the observed PE import closure, not a promise about arbitrary future plugin or dynamic library loading.

The explicit `--record-assets` flag regenerates the manifest only after successful artifact tests. A normal run compares the observed closure with the pinned manifest and verifies every hash. The manifest covers the exercised regular/bold Latin template configuration, not every TeX package, arbitrary font family, or future template change. Expand it deliberately if rendering dependencies change.

Backend integration must verify the required manifest before cold compilation and before a warm-cache return, bind template identity into letter canonical/cache identity, and test those actual runtime paths. Standalone corruption probes are not a claim that runtime enforcement already exists. The harness intentionally retains only synthetic evidence folders.

Package the adapted template and manifest deliberately, together with the upstream MIT notice, the acknowledged Jake Gutierrez MIT notice, and required Lato/package notices already inventoried with the pinned toolchain. Do not alter the downloaded upstream source or claim the original sample is the app's final letter. Package wiring, trusted escaping, canonical projection, live preview, approval, PDF/DOCX exports, and stale/destination guards remain backend work.
