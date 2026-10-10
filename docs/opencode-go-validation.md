# OpenCode Go integration validation

Integrates PR #43 and addresses the session-header request in issue #41, retaining StaySound4's original commits.

- The settings catalogue includes OpenCode Go and its icon. The preset remains Chat Completions only; its localized note states that only supported chat models are listed.
- Chat requests use the persistent `Conversation.id`. New conversations receive distinct IDs; restoring history or reloading retains the same ID, including requests forwarded through the extension background. Translation batches and their retries share one ID per translation job.
- OpenCode headers apply only to HTTPS OpenCode hosts without credentials or nonstandard ports. Background requests validate session IDs and resolve providers/credentials from saved settings.
- Go's public `/models` response currently mixes bare IDs from Chat Completions, Messages and Responses. A dated capability snapshot from [the official endpoint table](https://opencode.ai/docs/go/#endpoints), verified 2026-10-10, filters discovery and fallbacks to the 20 documented Chat Completions models. Sending manually configured unsupported/unknown models or another Go protocol endpoint fails before inference. Unknown models need an explicit snapshot update after verifying their official capabilities; no model-family guessing.
- Other providers keep their existing protocol behavior. This integration does not add API-key Messages/Responses support or change OAuth Responses handling.

## Validation

Three new regressions fail on the original PR: shared sessions, incompatible manual inference, and the mixed bare-ID catalogue. Final checks include the full extension/native suites, TypeScript, both Chrome edition builds, edition checks and diff checks. There is no lint script.

`scripts/test-opencode-go.cjs` runs against built `dist_local` in an isolated Chrome for Testing profile. Set `QIAOMU_PLAYWRIGHT`, `QIAOMU_EDGE`, `QIAOMU_TEST_OUTPUT` and `QIAOMU_TEST_MODELS` (a JSON snapshot of the public Go catalogue). It checks preset rendering, model filtering, multi-turn/new/history/reloaded conversations, and the actual background port handler. Inference uses synthetic SSE responses and a fixture key; it does not verify subscription entitlement, paid inference or OpenCode's acceptance of Clipper's non-coding workload. No account secrets or user browser profiles are used; no release or store submission.
