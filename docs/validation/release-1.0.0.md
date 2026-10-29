# CV Tailor 1.0.0 — Windows release

## Authorization and source

The maintainer accepted the current feature, explicitly authorized merging, installer replacement/installation, worktree cleanup and GitHub publication, then explicitly requested deletion of the old GitHub release. They chose to retain the **existing installed workspace**, not replace it with the preview data.

PR #124 merged as `5a61bf773206d74b76700978b709b562cf8e82e4`; version commit `e3cc485` sets both package and lockfile metadata to 1.0.0. No abandoned worktree code was merged. The owner merge used the existing admin bypass of the one-review rule after explicit maintainer approval; repository protections were not weakened.

## Installer

- File: `CV-Tailor-Setup-1.0.0.exe` (Windows x64, per-user NSIS).
- Size: **257,056,428 bytes**.
- SHA-256: **`4d28988affdacb4730fe971b0afb4d837896fa9a0dafba9241e412d1dd4e7483`**.
- Authenticode: **NotSigned**; unknown-publisher warnings are expected.
- Same app identity and installation location as 0.1.0; silent installer returned exit 0 and registration reports 1.0.0.

`npm run typecheck` passed. `npm run dist:win` logged completed build, source and packaged Electron SQLite ABI 140 checks, and source/packaged pinned LaTeX smoke compilation. Its outer command reached the final success marker before the harness reported its 480-second wrapper timeout; the artifact and all final packaged success records were then inspected rather than assuming an incomplete build passed. The installer was subsequently executed and its actual installed assets verified.

Installed `app.asar`, native SQLite binding, LaTeX toolchain metadata and cover-letter asset manifest match the verified unpacked build byte-for-byte. Physical dependencies were used; no worktree dependency junction was packaged.

## Genuine installed checks

The actual installed executable, not `win-unpacked`, confirmed `app.isPackaged`, version 1.0.0 and the exact isolated test `userData` before test writes. A fictional source-owned fixture had been prepared through the real generation API using a fake Pi runtime; **no real provider request** was made for this check.

Visible installed controls exercised paragraph source acknowledgment, issue check, real one-page compilation, independent letter approval, PDF canvas and native PDF/Word exports. The exported PDF had selectable expected text and one page; the DOCX contained the expected editable text. Appearance and approved-letter state survived closing/reopening through native SQLite. The removed CV check button was absent.

Before upgrade, both regular and preview workspaces received supported logical backups and validated online SQLite safety snapshots. The old published installer was retained locally and its digest checked. After upgrade, the actual regular workspace was opened and its profile, experience, project, job and CV rows matched the old snapshot; `quick_check` passed. Preview data was **not** copied into it. Private backups and test artifacts remain outside Git in `.audit/release-v1.0.0/`.

## Boundaries

No final repeated full suite or broad review round was run, following the maintainer's earlier instruction. The feature's focused checks and user acceptance remain recorded separately. This installed artifact check uses fictional model output, not installed live-provider generation or a guarantee of letter quality. Known issue #123 and the incomplete broad redistribution review remain explicit. GitHub published v1.0.0 as the latest stable release. GitHub's uploaded installer and checksum asset digests matched the local files before the old v0.1.0 release was deleted. The old Git tag/history and a verified local rollback installer were retained.

All five auxiliary worktrees were removed; only the main checkout remains on `main`. Their heads were preserved under archive refs and in a verified Git bundle; four nonignored untracked files, tracked-change patches and primary audit/test-result folders were archived locally before removal. Generated dependency/build artifacts were removed. The dependency junction was unlinked without traversing the main checkout's physical dependencies. Associated work branches and the merged feature branch were removed only after archival. The cleanup wrapper, like the build wrapper, reported a timeout after its final output; subsequent filesystem/ref checks confirmed all five directories absent and the main dependencies intact.
