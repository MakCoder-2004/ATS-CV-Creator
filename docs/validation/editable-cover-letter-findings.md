# Editable cover letters with factual findings

## User decisions

After the new diagnostic identified an unsupported-skill rejection, the maintainer chose **Keep draft**: retain the letter for editing rather than discard it, while blocking approval/export until findings are resolved. The maintainer also requested removal of **Check CV for issues**.

## Behavior

- Generation first validates structure, issued citation ordinals and detected unauthorized identifiers/placeholders. Those hard failures still discard the response.
- Otherwise it saves the letter and computes paragraph-level factual findings against frozen sources. Unsupported skills/numbers or attribution no longer make the whole letter disappear. Findings identify the affected skill/number where available. Edits rerun checks locally; no paid repair or retry is dispatched.
- Known findings block main-owned approval/export. Edits still require renewed acknowledgment, measured fit and explicit approval. The CV and profile are unchanged by letter review.
- The separate CV check button is removed. **Check page length** performs deterministic factual checks and actual PDF measurement together; it makes no model request. Existing review/export gates remain.

Earlier discarded responses cannot be recovered. A fresh explicitly authorized letter-only attempt is needed to obtain a letter under this behavior; it does not regenerate the CV.

## Focused evidence

Typecheck/build and 14 selected checks passed. These cover retained numerical/skill findings, successful local correction without a new model request, blocked approval, and continued rejection of malformed structures, foreign ordinals and detected private/unissued identifiers. Other tests in the selected files were filtered out, not claimed as run.

One real Electron scenario passed with a synthetic provider: the letter contains an unsupported skill, remains visible/editable with blocking findings, is corrected using visible controls, acknowledged, measured and approved, then exported as actual PDF and Word. It also confirms the removed CV button, combined page-fit action, and unchanged CV/profile during letter editing/export. The final finding-label detail was checked by the selected local tests after this UI run; the UI flow was not repeated for that copy-only refinement.

Evidence: `.audit/cover-letter-template/editable-letter-{focused,typecheck,build,visible}.log`. No full-suite repeat, automatic real-provider retry, installer, installation or merge is claimed.
