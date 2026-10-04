# Translation and Settings Changes

## Endpoint

Before: a root URL was requested directly, or normalized to `/chat/completions` without Magpie's required `/v1`.

After: a root URL resolves to `/v1/chat/completions`; `/v1` resolves to `/v1/chat/completions`; complete inference paths are retained. Existing custom gateway prefixes remain intact.

## Separate Models and Caption Languages

Before: translation reused the last chat model or the first enabled model. The caption language was lost between the selected track, cache, and study page. With only manually authored caption tracks, the first track could be Arabic even when an English track existed.

After: Settings contains separate answer and translation model selectors backed by separate persisted fields. Translation requires an explicitly selected enabled translation model and never falls back to the answer model. Each model retains its own provider and API key. The caption language travels with cached segments and transcript HTML. An English manual track is preferred when no automatic spoken-language track is available. Old cache entries remain readable.

Before: translation had a fixed Chinese prompt and page-only language assumptions.

After: seven target languages are selectable and persisted. The prompt identifies both source and target languages, preserves segment identifiers, and forbids other output languages. Missing metadata is displayed as uncertain text detection. Changing targets removes old translations before requesting a new result. Failed batches can still be retried without repeating completed batches.

Validation: targeted translation, caption, cache, settings manager and study-loader unit tests, TypeScript checking and whitespace checks. Live provider responses and private YouTube/Bilibili sessions still require browser acceptance.
