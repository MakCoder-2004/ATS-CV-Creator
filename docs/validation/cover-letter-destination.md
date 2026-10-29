# Cover-letter destination primitive

This validation unit adds a main-process-only destination capture and synchronous commit primitive for future PDF/DOCX callers. It does not select destinations, authorize overwrite, compile documents, or implement consent/body policy.

## API and behavior

- `captureLetterDestination(absolutePath)` accepts only an absolute path and returns an opaque, process-local, single-use handle with a read-only `exists` observation. The captured path and snapshot remain in a `WeakMap`; a structurally forged handle has no authority.
- `commitLetterDestination(handle, bytes, { overwriteApproved, beforeCommit })` accepts a copied, nonempty `Uint8Array` up to 20 MiB. Existing destinations require explicit `overwriteApproved: true`. `beforeCommit` must synchronously return `undefined`; thrown, non-void, and thenable results refuse the write. A valid unused capture is consumed immediately when commit begins, before validating bytes, options, overwrite approval, guard results, or destination state, so every refusal is single-use; invalid or forged handles cannot consume another capture. Failures use `LetterDestinationError` with bounded codes and no source/temp path in messages.
- Capture rejects a leaf symlink, directory, unreadable/non-regular destination, and an existing file above 20 MiB. Existing regular files are read with a strict size bound and captured with identity, metadata, and SHA-256. Commit rereads and compares the captured destination after the caller's final synchronous current-document guard.
- Commit writes/fsyncs/closes a random fixed-length basename in the destination directory. Existing approved files are atomically renamed over only after the final snapshot check; an originally absent path is installed using a hard link that refuses clobber. Only a temp file created by this operation is cleaned up. Capture handles cannot be reused, including after refused attempts.

## Race boundary and caller obligations

The snapshot detects normal create/delete/replace/modify changes, including same-size content changes with restored mtime. The bounded synchronous check and atomic operation reduce the stale-destination window; they do **not** eliminate every hostile filesystem race or provide a directory-handle/OS-level transaction. Callers must perform their own current-document/revision guard immediately before commit, capture only after the native dialog has resolved, and recheck document/source/approval state after dialogs and compilation immediately before invoking this primitive. This helper is not an overwrite-approval authority. Full export integration, compiler checks, model, renderer, installed-app, and hostile-filesystem race acceptance are separate gates.

## Evidence

Focused real-filesystem Vitest evidence and red/green command logs for the single-use refusal review fix are maintained in `.audit/cover-letter-destination-review-fix/`. See the committed test for exact gates. This unit does not claim full suite, native rebuild, live-provider, export integration, or installed-app validation.
