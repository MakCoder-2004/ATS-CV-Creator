# TinyTeX / TeX Live notices

CV Tailor's proposed Windows compiler bundle is based on the official TinyTeX-1 Windows release `v2026.10`, itself a portable, reduced TeX Live distribution. The exact provisioned TeX Live package names, revisions, catalogue versions and declared catalogue-license identifiers are recorded in `../latex-toolchain-lock.json`; `NOTICE.txt` is a human-readable snapshot of that inventory.

The compiler tree must retain its upstream `LICENSE.TL` and `LICENSE.CTAN` files. The accompanying copies here preserve TinyTeX's upstream GPL-2 notice and provide common license texts relevant to the provisioned packages (LPPL 1.3c, SIL OFL 1.1, and MIT). TinyTeX's GPL applies to TinyTeX's own code; it does not relicense TeX Live or its packages. TeX Live explicitly has no single license for its contents, and the package's own legal text is authoritative.

This inventory is not a legal determination that redistribution is compliant. Catalogue metadata can omit a license, use broad labels such as `other-free`, or report multiple licenses. Before release, review the actual license/copyright notices for every shipped package and binary, including licensing conditions on font binaries, and ensure source-offer/attribution obligations are met. `LICENSE.CTAN` describes the broader CTAN snapshot; it is retained because it ships with the upstream TeX Live tree, not as a claim that TinyTeX contains that entire snapshot.

Primary sources:

- [TinyTeX release repository and README/license](https://github.com/rstudio/tinytex-releases)
- [TinyTeX v2026.10 release](https://github.com/rstudio/tinytex-releases/releases/tag/v2026.10)
- [TeX Live redistribution conditions](https://tug.org/texlive/LICENSE.TL)
- [LaTeX Project Public License 1.3c](https://www.latex-project.org/lppl/lppl-1-3c.txt)
- [SIL Open Font License](https://openfontlicense.org/documents/OFL.txt)
- [MIT license](https://spdx.org/licenses/MIT.html)

These files are third-party notices for the compiler distribution. Include this directory and the TinyTeX tree's root license files in any installer/package that redistributes the toolchain.
