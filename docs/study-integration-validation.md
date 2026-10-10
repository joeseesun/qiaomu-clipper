# Study integration validation

Integrates PR #59 with the embedded-player routing intent of PR #58 and fixes issue #62.

- Draft text writes use a shared-origin Web Lock and reject stale text snapshots. Player metadata, preferences and delivery receipts update only their fields. Expired-media recovery does not rewrite the old tab's text.
- Study identity exists independently of a playable media URL. Edited caption-only drafts are retained and found by their source after preview cleanup.
- Editor copy/download collect the current form without requiring storage or media handoff to succeed.
- YouTube/Bilibili return to their embedded study route and render the saved edited Markdown, without replacing it with fetched captions.
- Both native atomic JSON writers retry Windows errors 5/32/33 for at most 40 attempts. Other errors and exhausted retries propagate; temporary files are removed. Failed progress writes do not consume the throttle slot.
- Xiaoetong HLS uses a temporary token-protected loopback relay: nested manifests, segments, initialization data and AES keys are checked against the same HTTPS host allowlist, including redirects. Playlist and fragment reads are bounded. Signed addresses remain out of durable draft text and downloader errors.

## Local checks (2026-10-10)

`npm test`, `npx tsc --noEmit`, `python -m unittest discover -s native -p 'test_*.py'`, both Chrome edition builds, `node scripts/check-editions.mjs` and `git diff --check`.

The native compatibility workflow runs atomic JSON tests, including concurrent readers, on Windows/macOS/Linux with Python 3.12. There is no npm lint script in this repository.

## Reproducible browser checks

Use a freshly built `dist_local`, an isolated Chrome for Testing/Edge profile and an installed Playwright module. Set `QIAOMU_PLAYWRIGHT`, `QIAOMU_EDGE`, `QIAOMU_TEST_VIDEO` and `QIAOMU_TEST_OUTPUT`; linked checks additionally need `QIAOMU_TEST_HLS`.

- `node scripts/test-local-media-modes-edge.cjs`: local file playback, seek, edit/read, refresh, expiry/reselect, failed handoff; one recognition/upload.
- `node scripts/test-linked-study-modes-edge.cjs`: Channels resolver and Xiaoetong shop/API/HLS fixtures, mode switches, edited recovery, no credential export and duplicate recognition.
- `QIAOMU_TEST_NO_HLS=1 node scripts/test-linked-study-modes-edge.cjs`: caption-only editing and restoring by the original short URL after a simulated 72-hour expiry.
- `node scripts/test-study-concurrency.cjs`: old playable/expired tabs, competing edits, clipboard/download rescue under failed storage, and edited YouTube/Bilibili reading DOM with fixture iframe surfaces.
- `python scripts/test-native-hls-fixture.py <fixture-hls-directory>`: actual installed yt-dlp and ffmpeg, including AES-128 when the directory contains an encrypted playlist and key. Upstream requests are synthetic fixture reads.

Browser evidence is from a built extension, fixture websites and mocked Native Messaging. It does not establish real account login, paid-course entitlement, actual YouTube/Bilibili playback, or the user's installed helper/extension behavior. No release or store submission is part of this integration.
