# Declared experience kinds in letter context

## Problem and predicate

The authorized profile already distinguishes employment from training. The initial letter source projection retained titles, organizations, descriptions and parents, but omitted the declared kind from the model's numbered facts. That omission also left no resolved kind metadata for the later review read model.

The predicate is that an explicitly declared kind reaches its role and nested facts without inventing a kind when absent, sending local IDs, changing persisted source passages/ordinals, or turning classification into a semantic-truth guarantee.

## Change

`prepareCoverLetterSources` copies a known kind through the existing domain schema into the minimized outgoing role/fact entries. Its separate local `experienceKinds` map uses actual evidence IDs and is never included in the model prompt. Local source snapshots and their issued mapping remain unchanged. The prompt says that training alone does not establish employment and missing kinds must not be inferred.

The provenance resolver exposes the map from the completed CV parent's frozen source, not current mutable profile guesses or model assertions. The later main read model must pass that authoritative map to `CoverLetterReview.experienceKinds`. The component renders Employment or Training beside a source only when supplied. It does not infer an unknown kind or print these review labels in artifacts.

No profile record, source version, consent input hash, source passage, canonical letter, template or CV serialization is changed. The classification was already part of the authorized minimized profile; this preserves it in the selected task's factual context. It does not prove that every resulting employment statement is entailed. Human paragraph review remains required.

## Verification and remaining wiring

The new source-projection and rendered-context regressions failed before implementation (`.audit/cover-letter-template/experience-kind-red.log`) and pass afterward (`experience-kind-green.log`). They verify both known kinds, inheritance by nested facts, unchanged local source mappings, no inferred unknown kind, and display only for the supplied source identity. Existing privacy and public generation tests pass alongside them.

Typecheck evidence is `.audit/cover-letter-template/experience-kind-typecheck.log`. Full regression and independent review are recorded in the canonical decision trail. This component prop is not yet wired into the production host; main read-model and visible-flow acceptance remain in the planned integration units.
