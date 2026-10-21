# LaTeX PDF compilation for CV Tailor

**Research date:** 2026-10-21  
**Scope:** Windows Electron deployment for the supplied `CV/overleaf template/` LaTeX source. Research only; no application implementation was changed. Empirical spikes used task-owned temporary folders: the MiKTeX setup attempt failed to create a tree, while TinyTeX was extracted and provisioned successfully.

## Finding in brief

**Current recommendation: carry forward a bundled, pinned TinyTeX-1-based `pdflatex` toolchain with all packages pre-provisioned.** Its successful compile of the unchanged template rendered pixel-identically to the supplied reference under the same PDF.js renderer. MiKTeX remains a possible fallback but its portable setup attempt did not complete. Do not select Tectonic as a drop-in compiler: the template explicitly depends on pdfTeX-specific `\pdfgentounicode` and `glyphtounicode`, while Tectonic is XeTeX-based.

The exact rendered match is limited to the supplied placeholder reference and test environment; it does not certify populated CVs, app packaging, or network-isolated operation. TeX package versions, fonts and engine behavior can differ; pin and validate the entire shipped tree.

## Supplied template facts

`resume.tex` uses `\documentclass[letterpaper,11pt]{article}`, `\input{glyphtounicode}`, `\pdfgentounicode=1`, and `\usepackage[default]{lato}`. It also loads `fontawesome5`, `latexsym`, `fullpage`, `titlesec`, `marvosym`, `color`, `verbatim`, `enumitem`, `hyperref`, `fancyhdr`, `babel`, and `tabularx`; it includes `custom-commands.tex` and five `src/*.tex` components. The `src` files define a compact heading, education, experience, projects, and technical skills; **there is no summary section** in this supplied template. The template contains placeholder content, not a compiler-independent CV schema.

The template’s `\pdfgentounicode` setting and `glyphtounicode` input are specifically documented by the pdfTeX manual as a way to add glyph-to-Unicode mappings for PDF text extraction. Preserve them if matching the pdfLaTeX template is the priority. (The template itself is the evidence for its engine-specific dependency.)

Conciseness and evidence-backed content are generation/data policy requirements, not properties supplied by a TeX engine. Keep the generated content constrained to approved career facts, omit summary content, and populate the template’s sections through application-side validation. A successful compile does not prove factual support or ATS quality.

## Options

| Option | Compatibility with this exact template | Windows and deployment | Network/offline behavior | Security and licensing |
|---|---|---|---|---|
| **MiKTeX + pdfLaTeX** | Best direct fit among options researched: pdfLaTeX matches the template’s pdfTeX primitives. Required packages need to be present. MiKTeX’s package manager can install missing packages. | Official Windows installer is available. MiKTeX has a portable edition that does not use the Windows Registry or require admin rights; that is a deployment mode, not evidence that bundling it in CV Tailor is already tested. | Can install packages on demand, controlled by a prompt/always/never policy. That is convenient for a desktop first run but introduces network dependency, latency, update drift, and potential network requests from a build. A pre-populated, fixed package set can avoid runtime package downloads; validate this deployment mode. | MiKTeX says redistribution is allowed subject to applicable licenses, but it has no single license because constituent packages have their own terms. Inventory notices/licenses for the exact distribution and selected packages. Configure unattended builds to **never** install packages or use an offline repository/bundle strategy if runtime package downloads are unacceptable. |
| **TeX Live + pdfLaTeX** | Best engine match as well; standard `pdflatex` can honor pdfTeX primitives. Use a pinned release and ensure the template’s packages are installed. | Official Windows installation supported. TUG provides an Internet installer and DVD/ISO installation path. A full TeX Live installation is comparatively large; a selected scheme may reduce footprint but must be proven complete. | DVD/ISO enables offline installation. `tlmgr` manages packages; subsequent package installs/updates generally need a repository or local mirror. A pinned preinstalled distribution avoids user-facing package installation at first run. | TeX Live includes packages with differing licenses; check actual package licenses before redistribution. This is a complete distribution with a larger packaging/update surface than a small single executable. |
| **TinyTeX-1 + pdfLaTeX** | Exact engine family. The v2026.10 Windows archive compiled this unchanged template after provisioning missing packages; render was pixel-identical to the supplied PDF under PDF.js at 2×. | Portable TeX Live-based tree; the 70.2 MiB archive expanded to 362 MiB after template packages were installed. Extracting required no installer/PATH/registry changes. | Prepopulate all required packages and prohibit tlmgr/network activity during export. Compilation succeeded with all resources local and `--no-shell-escape`; host network remained enabled, so physical network isolation is unverified. | TinyTeX release project is GPL-2; TeX Live and included packages have their own conditions. Review notices for exact redistributed tree. No runtime auto-install behavior used by `pdflatex` in this test. |
| **Tectonic** | **Not a drop-in match.** Official docs describe it as XeTeX-based, not pdfTeX. Therefore `\pdfgentounicode` is not a supported reason to expect the same build; changing/removing it and checking the `glyphtounicode` behavior would be an engine migration, not fidelity-preserving compilation. The LaTeX packages may be available in its TeX Live-derived support bundle, but package availability does not resolve the engine mismatch. | Official Windows install instructions and prebuilt binaries exist. It is attractive as a compact executable rather than a full user-managed TeX installation. | Downloads TeX support files (“bundles”) as needed and caches them. `--only-cached` disallows fetching missing files; local `.ttb`/legacy `.zip` bundles are supported. A first-run connected build therefore has fetch behavior unless the bundle/resources are provisioned; fully offline operation needs a complete local bundle/cache. | Shell escape is off by default; Tectonic documents `--untrusted` as preventing shell escape. Treat generated `.tex` as untrusted, do not enable shell escape, and run with restricted filesystem/process permissions regardless. Tectonic software is MIT-licensed, but its bundled TeX support files are separately licensed; audit redistribution contents. |

## Recommended deployment direction

1. **Use pdfLaTeX, not Tectonic, to preserve the current template.** The TinyTeX spike compiled unchanged source and matched the supplied reference exactly under the same renderer.
2. **Advance pinned TinyTeX-1 + pre-provisioned packages as the candidate; retain MiKTeX portable as an unvalidated alternative.** TinyTeX was extracted/compiled without installer, PATH, or registry changes, but its 362 MiB expanded test tree and licensing/packaging work remain material concerns.
3. **Do not permit on-demand package installation during export.** A missing package should produce a clear, recoverable error, not silently initiate arbitrary download/update behavior. Pin the compiler and package set; test offline and on a fresh Windows machine.
4. **Treat LaTeX input and compiler execution as a security boundary.** Invoke a fixed executable with argument arrays (not a shell command string), use a unique temporary working directory, disable shell escape, restrict filesystem/network access where practical, enforce time/resource limits, and clean up temporary sources. Do not assume the compiler's own defaults make generated input safe. The exact Windows sandboxing mechanism remains a product/engineering decision.
5. **Validate licenses before shipping.** Record the compiler/distribution version, package manifests, license/notice files, and required attribution. Do not infer a single umbrella license for MiKTeX, TeX Live, or a Tectonic support bundle.

## Isolated portable MiKTeX fidelity spike (2026-10-21)

**Outcome: blocked before compilation.** The unchanged source was not compiled and no output PDF was generated. The installer download succeeded, but the portable setup attempts produced no visible setup result and left no installation tree; therefore no valid engine/package versions or portable-tree size can be reported. No application code, global install, system PATH, or registry changes were made.

- Baseline file: `CV/cv_Template.pdf`. Existing `pdfjs-dist` was used read-only to inspect it: 1 page, 612 × 792 pt (US Letter), 150 text items / 3,035 extracted characters, and three link annotations (`mailto:firstlast@gmail.com`, LinkedIn, GitHub). Text begins “First Last … Education …”. This is the supplied placeholder reference, not a populated CV.
- Environment: Windows x64 through the user's fresh Windows environment; no `pdflatex`, `miktexsetup`, or `tectonic` was on PATH before the spike.
- Downloaded from the official MiKTeX download page's x64 Basic Installer link: `basic-miktex-25.12-x64.exe` (141 MiB; official page listed 141.98 MB). SHA-256 observed: `14B42DD9F4B4A7813A8BFD69C8F99316C2888CC4EE26F631F397E163D85D6C62`. PowerShell `Get-AuthenticodeSignature` reported `NotSigned`; this is recorded as a deployment/integrity concern, not an assertion the download is malicious.
- Temporary folder: `C:\Users\Makrious\AppData\Local\Temp\cv-tailor-latex-spike`. The official installer was renamed to `miktex-portable.exe` per MiKTeX's portable instructions, then invoked with `--portable --package-set=basic --no-registry --unattended --user-install=<temp>`. A subsequent documented setup-wizard dry-run returned exit code 0 but did not leave an installation tree; rerunning did not change that. The folder contains only the downloaded installer and fetched download-page HTML; no compiler or generated PDF.
- No package prepopulation, offline/no-auto-download compile, geometry/font/link comparison against fresh output, or visual comparison could be completed. There are no install/compile error logs; observed symptom was silent exit/no installation. The actual MiKTeX setup route may require interactive wizard operation or another invocation/parameters. Do not treat this as evidence that MiKTeX portable is broken.
- No long retries were made. The missing empirical result means the earlier preference for MiKTeX portable remains a hypothesis only. Next useful test requires a supported interactive setup or a documented, working unattended portable-install path, followed by explicit package provisioning and an offline compile. If setup cannot be made repeatable, compare a known TeX Live portable/install tree rather than weakening the exact-template compatibility requirement.

Official setup guidance: [MiKTeX Portable Edition](https://miktex.org/howto/portable-edition) says to rename the Basic installer to `miktex-portable.exe` and run it; [Setup Wizard CLI](https://docs.miktex.org/manual/setupwiz.html) documents `--portable`, `--package-set=basic`, `--no-registry`, and `--unattended`. The page now describes a newer installer version than the downloaded 25.12 artifact, so preserve and validate exact version/source in a repeatable spike.

## Isolated TinyTeX portable fidelity spike (2026-10-21)

**Outcome: successful compile and exact rendered match for the supplied placeholder template.** TinyTeX-1 gave a working, self-contained Windows TeX Live tree without running an installer, modifying PATH/registry, or requiring administrator rights. This is the more promising deployment candidate to carry forward than MiKTeX based on this bounded test; it is not yet a shipped-app validation.

### Artifact, setup, package set

- Official release: [`rstudio/tinytex-releases` v2026.10](https://github.com/rstudio/tinytex-releases/releases/tag/v2026.10), asset [`TinyTeX-1-windows-v2026.10.exe`](https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/TinyTeX-1-windows-v2026.10.exe), 73,701,889 bytes (70.2 MiB); SHA-256 `36c329c644683d981a668419d13c8804696e2816ae4d287ad755788fee231a31`.
- Although its suffix is `.exe`, official release documentation calls Windows binaries self-extracting archives. 7-Zip listed it as a 7z archive and extracted it without executing it.
- Extracted base tree: `C:\Users\Makrious\AppData\Local\Temp\tinytex-spike\unpacked\TinyTeX`; expanded size after provisioning: 362 MiB. No TinyTeX installer or `tlmgr path add` was run. Compilation used the absolute path to `bin\windows\pdflatex.exe` from a temporary copied source tree; no PATH/registry/global installation changes.
- Initial TinyTeX-1 included TeX Live 2026/pdfTeX but lacked some template packages. Provisioning was performed once with local `tlmgr`; the resulting offline compile has no package auto-install mechanism. Needed package IDs: `babel-english`, `enumitem`, `fancyhdr`, `fontawesome5`, `fontaxes`, `hyphen-english`, `lato`, `marvosym`, `preprint` (provides `fullpage.sty`), and `titlesec`. Some were already dependencies; `fontaxes` was discovered on the next compile. `fullpage` is not a standalone tlmgr package.
- Relevant installed package versions and TeX Live catalog revisions: `fontawesome5` 5.15.4/rev 77682; `lato` 3.3/rev 79618; `preprint` 2011/rev 30447; `titlesec` 2.17/rev 77682; `marvosym` 2.2a/rev 79618; `enumitem` 3.11/rev 79618; `fancyhdr` 5.2/rev 78348; `fontaxes` 2.0.2/rev 77682; `babel-english` 3.3r/rev 77682; `hyphen-english` rev 78069 (no catalog version reported).
- Engine output: `pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)`, kpathsea 6.4.2; LaTeX2e 2026-06-01; tlmgr self-updated to revision 80658 (2026-10-16) before package installation. Both are local to this extracted tree.

### Reproducible commands

Commands below assume 7-Zip installed and a temporary root `C:\Users\Makrious\AppData\Local\Temp\tinytex-spike`; package provisioning requires network once, before offline use. Run the compiler with the copied template as working directory.

```powershell
7z x -y '-oC:/Users/Makrious/AppData/Local/Temp/tinytex-spike/unpacked' `
  'C:/Users/Makrious/AppData/Local/Temp/tinytex-spike/TinyTeX-1-windows-v2026.10.exe'
$bin = 'C:\Users\Makrious\AppData\Local\Temp\tinytex-spike\unpacked\TinyTeX\bin\windows'
& "$bin\tlmgr.bat" option repository https://mirror.ctan.org/systems/texlive/tlnet
& "$bin\tlmgr.bat" update --self
& "$bin\tlmgr.bat" install fullpage titlesec marvosym enumitem fancyhdr fontawesome5 lato babel-english
# `fullpage` package ID is not present; install `preprint` instead.
& "$bin\tlmgr.bat" install preprint fontaxes
# two passes; network/package manager not invoked during either compile
& "$bin\pdflatex.exe" --no-shell-escape -interaction=nonstopmode -halt-on-error resume.tex
& "$bin\pdflatex.exe" --no-shell-escape -interaction=nonstopmode -halt-on-error resume.tex
```

The first package install reported `fullpage` absent and otherwise installed the requested packages; the follow-up `preprint` and `fontaxes` installs resolved those dependencies. Compilation initially reported missing `fontawesome5.sty`, then missing `fontaxes.sty`; after provisioning it completed successfully. First pass warned about small `\footskip`, font shape substitution, and rerunning for outlines; second pass completed. No source changes were made.

### Comparison against supplied reference

- Output PDF: `C:\Users\Makrious\AppData\Local\Temp\tinytex-spike\work\resume.pdf` (about 111 KiB); temporary copied TeX source/logs are in `...\tinytex-spike\work\`.
- Reference `CV/cv_Template.pdf` and generated output both have 1 page, 612 × 792 pt, 150 PDF.js text items / 3,035 extracted characters, and the same three link targets (email, LinkedIn, GitHub).
- Both were rendered at 2× using the repository's installed PDF.js + `@napi-rs/canvas`; pixel comparison reported **0 differing color channels across 7,755,264 channels**. This is an exact rendered match for this placeholder reference under the same renderer/settings, much stronger than a visual spot-check. `pdftotext -layout` also showed matching lines in the inspected section. This does not establish exact match for changed CV content or another compiler/package baseline.
- Compile command explicitly used `--no-shell-escape`. All needed files were local and TeX Live/pdfTeX did not invoke tlmgr or package downloads during compilation. The host still had network access; a physically disconnected/network-firewalled compile was not tested. Thus dependency-complete offline behavior is strongly indicated, but not network-isolation certified.
- No standalone font inventory tool was available. Fonts rendered pixel-identically to the reference; logs show Lato Type 1 files and Font Awesome 5 regular/brands fonts loaded. The LaTeX run did emit font shape substitution warnings (`lato-TLF` small-caps shapes); PDF visual comparison nevertheless had zero differing pixels against the supplied baseline.

### Recommendation update and caveats

Advance **pinned TinyTeX-1 + pre-provisioned, pinned packages + direct `pdflatex --no-shell-escape`** as the preferred implementation spike/deployment candidate. Its base compressed artifact is 70 MiB and the test-provisioned tree expanded to 362 MiB, so it is not a tiny embedded compiler; decide whether that installer/runtime size is acceptable. Package updates/downloads must not happen during export. For genuine offline certification, repeat compilation with networking disabled in an approved isolated environment. Capture the post-provision package manifest and all per-package license notices before redistribution. TinyTeX release documentation says it is a portable TeX Live-based distribution; the upstream repo's code/distribution is GPL-2 and TeX Live/components have their own terms, which still need review for the exact asset.

The prior MiKTeX portable attempt remains blocked; it is not a tested counterexample. No application/export integration, populated CV, fresh installed app, child-process sandbox, installer, or user-facing license notice was tested.

Official references: [TinyTeX Windows releases and asset description](https://github.com/rstudio/tinytex-releases), [v2026.10 release](https://github.com/rstudio/tinytex-releases/releases/tag/v2026.10), [TinyTeX overview/install/portable behavior](https://yihui.org/tinytex/), [TinyTeX FAQ on size, bundle, and distribution](https://yihui.org/tinytex/faq/), and [upstream repo README/license](https://github.com/rstudio/tinytex-releases).

## Build-time toolchain preparation and verification

The compiler bundling seam is now prepared under the scoped non-application files. `scripts/prepare-latex.cjs` downloads only the fixed official v2026.10 asset, verifies both its exact byte size and SHA-256, inspects/extracts it with 7-Zip (does not execute the `.exe` self-extractor), provisions the package list at build time, then compares the complete installed package manifest against `resources/latex-toolchain-lock.json`. Any extra/missing package or revision/catalogue metadata drift fails closed. `node scripts/prepare-latex.cjs --from <tree>` accepts an already provisioned local tree and only validates/copies it; it does not fetch packages. Neither path alters system PATH or the registry. The runtime metadata `cv-tailor-toolchain.json` records schemaVersion, engine family/version, `pdflatex.exe` SHA-256, distribution release, and package-manifest SHA-256.

- Prepare from the already validated local tree: `node scripts/prepare-latex.cjs --from "C:\\Users\\Makrious\\AppData\\Local\\Temp\\tinytex-spike\\unpacked\\TinyTeX"`.
- Fresh official asset path (build-time network required): `node scripts/prepare-latex.cjs` (requires 7-Zip in PATH or `SEVEN_ZIP`; package mirrors must still match all locked revisions).
- Verify/copy compile smoke: `node scripts/verify-latex.cjs --smoke`. Verification never downloads or installs packages. It checks the root metadata, compiler hash/version, full package lock, root and companion notices; `--smoke` compiles the unchanged source twice with `--no-shell-escape`.
- Both fresh preparation and `--from` preparation succeeded against the lock; `verify-latex.cjs --smoke` succeeded. The local prepared tree for parent integration is `E:\\cv-tailor-main\\.tools\\latex` (362 MiB). It is a local generated bundle, not a source-controlled binary. The test output remains at `C:\\Users\\Makrious\\AppData\\Local\\Temp\\tinytex-spike\\work\\resume.pdf`.
- License materials are in `resources/latex-licenses/`: TeX Live's own `LICENSE.TL`/`LICENSE.CTAN` remain in `.tools/latex`; companion notices include TinyTeX's tagged GPL-2 text, LPPL 1.3c, OFL 1.1 and MIT texts, plus a per-package inventory in `NOTICE.txt`. The lock includes all 132 TeX Live package names/revisions and available catalogue license/version metadata. This is a traceable inventory, **not a completed legal review**: some packages have no catalogue license or broad/multiple labels, so the exact package/binary notices must still be checked before redistribution. Bundle both `.tools/latex` and `resources/latex-licenses` in the installer; do not include `.tools/latex` in Git.

## Validation gates before implementation

- Compile the untouched supplied template through the exact candidate engine and package set; record engine/version and package versions.
- Compare page count, geometry, font selection, icon rendering, links, text extraction/Unicode mapping, and visual output to the Overleaf baseline. A basic successful build is insufficient.
- Exercise a clean Windows user profile, offline export, missing-package behavior, paths with spaces, timeouts, malformed/oversized generated source, and installer/uninstaller behavior.
- Verify that a minimal installed toolchain includes every package/font actually used and that license notices cover all redistributed artifacts.
- Separately test the generation pipeline’s summary omission, source-evidence constraints, and length/section limits; LaTeX compilation cannot enforce them.

## Sources (primary/official)

- Supplied source: [`CV/overleaf template/resume.tex`](../../CV/overleaf%20template/resume.tex), [`custom-commands.tex`](../../CV/overleaf%20template/custom-commands.tex), and [`src/`](../../CV/overleaf%20template/src/).
- pdfTeX manual, glyph-to-Unicode discussion: [pdfTeX manual PDF (TUG/CTAN)](https://tug.ctan.org/systems/doc/pdftex/manual/pdftex-a.pdf).
- Tectonic’s engine description and limitations: [Introduction](https://tectonic-typesetting.github.io/book/latest/introduction/index.html).
- Tectonic install, including Windows: [Install Tectonic](https://tectonic-typesetting.github.io/book/latest/getting-started/install.html).
- Tectonic bundle/cache/offline operation: [Build Your First Document](https://tectonic-typesetting.github.io/book/latest/getting-started/first-document.html), [CLI reference](https://tectonic-typesetting.github.io/book/latest/ref/v1cli.html), and [Tectonic.toml](https://tectonic-typesetting.github.io/book/latest/ref/tectonic-toml.html).
- Tectonic shell-escape and untrusted-input controls: [Tectonic.toml security options](https://tectonic-typesetting.github.io/book/latest/ref/tectonic-toml.html).
- Tectonic software license: [repository LICENSE](https://github.com/tectonic-typesetting/tectonic/blob/master/LICENSE); bundle scope: [bundles README](https://github.com/tectonic-typesetting/tectonic/blob/master/bundles/README.md).
- MiKTeX Windows installation and on-the-fly package behavior: [Install MiKTeX on Windows](https://miktex.org/howto/install-miktex).
- MiKTeX portable mode: [Portable Edition](https://miktex.org/howto/portable-edition).
- MiKTeX redistribution/licensing: [Redistributing MiKTeX](https://miktex.org/kb/copying).
- TeX Live Windows installation and offline DVD/ISO option: [Windows — TeX Live](https://tug.org/texlive/windows.html).
- TeX Live package management and licensing note: [Installing and updating packages](https://tug.org/texlive/pkginstall.html).
- Template package references: CTAN [fontawesome5](https://ctan.org/pkg/fontawesome5), [lato](https://ctan.org/pkg/lato), and [glyphtounicode/pdfTeX manual](https://tug.ctan.org/systems/doc/pdftex/manual/pdftex-a.pdf).

## Product decisions and implementation follow-through

The user confirmed **content-only generation**, **the literal supplied template structure** (no summary, target-headline line or Certificates), and **a self-contained offline app** rather than a separate compiler installation or first-run package download. The implementation selects the validated TinyTeX/pdfLaTeX tree; the locked 132-package manifest and provisioning scripts above define its baseline. The renderer never receives compiler paths or raw TeX. Measurement, actual PDF preview and export share the compiled bytes; compilation uses escaped text, a fixed executable, no shell escape, private temporary sources, output limits, and a 20-second deadline per pass. This is not an OS sandbox.

A populated Unicode regression exposed an original-template issue: OT1 font encoding extracts “Zoë” and “résumé” as out-of-order accent glyphs. For extended Latin content the compiler adds `\\usepackage[T1]{fontenc}` before the existing Lato package; the source template itself, layout macros, margins and paper size remain unchanged. Pure ASCII template compilation remains unchanged and pixel-identical to the supplied baseline. The Unicode test requires correct extracted accented text rather than relaxing the reading-order guard.

Installer, actual installed-app/native SQLite reopen, compiled-PDF checks and complete regression results are recorded separately in `docs/validation/latex-export.md`. Runtime compilation uses only bundled dependencies and does not invoke tlmgr. Physical firewall/network-disconnection isolation was not tested. Public redistribution still needs a full third-party licensing review; included notices/inventory are not legal certification. The original Overleaf cloud engine/package snapshot remains unknown, so the supplied PDF—not an unrecorded cloud environment—is the visual reference. Future compiler updates must deliberately update pins and rerun visual, extraction and installer checks.
