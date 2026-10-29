# Natural cover-letter typography

This is a bounded document-compatibility correction, not generation, export, or installed-app acceptance.

## Observed failures

A direct compile with the unchanged approved application template showed that pdfTeX emits a typographic apostrophe for ordinary ASCII input. `It's` extracted as `It’s`. The strict letter PDF comparison therefore rejected an ordinary English sentence even though its text and embedded fonts were correct.

The same experiment rendered en/em dashes, curly single/double quotes, and an ellipsis using the existing pinned font assets. The ellipsis extracted as three spaced periods. Recorder inspection found no additional toolchain input outside the existing 39-asset manifest. The actual glyph evidence is retained under `.audit/cover-letter-template/punctuation-*/observation.json` and `punctuation-glyphs.log`.

Separate regressions showed that the printable schema rejected those verified English characters and that structured review refused canonically equivalent decomposed/composed accented wording. `.audit/cover-letter-template/natural-typography-red.log` records all three failing tests before the correction.

## Correction

The printable letter schema accepts only the additional tested English punctuation characters, while retaining the existing control/bidi and unsupported-script refusals. It does not accept all Unicode punctuation or remove unsupported-character checks.

PDF comparison treats straight/curly quotes and ellipsis representations as typographic equivalents, alongside existing NFC and whitespace normalization. It still compares all words and their order. The actual renderer, authored wording, frozen sources, template, fonts, asset manifest, and existing CV serialization are unchanged. A changed-adjective negative test still refuses mismatched PDF content.

Structured review compares paragraph wording in NFC form, consistent with the canonical projector. It does not change stored wording or source acknowledgments. This prevents equivalent accented strings from being mistaken for another revision.

## Gates

- `tests/cover-letter-document.test.ts` verifies the added English typography and continued bidi/Arabic refusal.
- `tests/cover-letter-artifacts.test.ts` compiles actual apostrophe and typographic paragraphs, inspects selectable PDF text, and rejects changed wording. Its owned copied-toolchain test also compiles successfully from a path containing spaces before checking asset corruption.
- `tests/cover-letter-review-markup.test.ts` verifies that canonically equivalent accented wording stays reviewable.
- Focused green output and typecheck are in `.audit/cover-letter-template/natural-typography-green.log` and `natural-typography-typecheck.log`.

## Complete text-stream comparison

Independent review then found a pre-existing substring weakness around the typography normalization. A synthetic inspected-text substitution could extend canonical `I can` to `I can’t`, append words or numbers, or insert unrelated text between fields. The unchanged compiler was not demonstrated to produce those substitutions, but the comparison helper accepted them and therefore did not establish the claimed boundary.

A regression first reproduced that refusal failure using a real compiled baseline followed by explicitly altered parsed text. The comparison now requires equality of the complete normalized expected stream, including the actual contact separators, rather than locating fields as arbitrary substrings. Quotes, ellipses, NFC and layout whitespace remain the only equivalences. Letters, digits, negations, field order and extra text remain significant. `.audit/cover-letter-template/full-stream-pdf-red.log` records the failing prefix case; `full-stream-pdf-green.log` records the corrected focused suite. This is a helper-boundary substitution test, not evidence that the current renderer changed a sentence's meaning.

This changes acceptance of previously rejected input and PDF text comparison, not the layout or output of an already accepted document. The immutable template identity remains unchanged. No compiler integrity, font lookup, unsupported-script, overflow, source, or approval guard was relaxed.
