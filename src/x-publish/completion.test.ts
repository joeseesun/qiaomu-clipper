import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
const engine = readFileSync(process.env.QIAOMU_X_ENGINE_FIXTURE || 'src/x-publish/main-world.js', 'utf8');
it('does not restore pre-cleanup placeholders while React is committing onChange', async () => {
  let current = { marker: true }, pending: typeof current | undefined;
  const draft = () => ({ props: { editorState: current } });
  const args = {
    progress: vi.fn(), findDraftStateNode: draft,
    cleanupMarkers: () => { pending = { marker: false }; return 1; },
    kickRender: (node: ReturnType<typeof draft>) => { pending = node.props.editorState; },
    sleep: async () => { if (pending) { current = pending; pending = undefined; } },
    throwIfCancelled: () => {},
  };
  const begin = engine.indexOf('    progress("Cleaning up import markers...")');
  const end = engine.indexOf('    assertArticleTextPreserved(', begin);
  const flow = new Function(...Object.keys(args), `return (async () => {let draftNode=findDraftStateNode(); const summary={markersCleaned:0},payload={markerPrefix:'__XPOSTER_test_'};${engine.slice(begin,end)}})()`);
  await flow(...Object.values(args));
  expect(current.marker).toBe(false);
});
it('refuses success when a placeholder or an uploaded body media block is still missing', () => {
  const begin = engine.indexOf('  function assertImportedMedia('), end = engine.indexOf('  function kickRender(', begin);
  const check = new Function('markerTokenPattern', engine.slice(begin,end) + '; return assertImportedMedia;')(() => /__XPOSTER_test_IMAGE_\d+__/);
  const content = (text: string, has: boolean) => ({ getPlainText: () => text, getBlockMap: () => new Map(has ? [['media', { getType: () => 'atomic' }]] : []) });
  const uploads = [{ blockKey: 'media' }];
  expect(() => check(content('__XPOSTER_test_IMAGE_14__', true), uploads, 'test')).toThrow();
  expect(() => check(content('完整正文', false), uploads, 'test')).toThrow();
  expect(() => check(content('完整正文', true), uploads, 'test')).not.toThrow();
});
it('never credits a previously completed media block as the next upload when props are stale', async () => {
  const state = {}, draft = { props: { editorState: { getCurrentContent: () => state } } };
  const args = { throwIfCancelled: () => {}, placeSelectionAtMarker: () => ({ blockKey: 'marker', offset: 0, length: 6, exact: true }), sleep: async () => {},
    findDraftStateNode: () => draft, existingMediaEntities: () => Object.assign(new Set(), { blockKeys: new Set() }), requestPreparedFile: async () => ({ base64: 'AQID' }),
    base64ToFile: () => ({ type: 'image/png' }), findOnFilesAdded: () => () => {}, observeNativeMediaUpload: () => ({ status: () => ({ state: 'ready' }), dispose: () => {} }),
    findNewMediaUpload: (_content: unknown, before: { blockKeys: Set<string> }) => ({ blockKey: before.blockKeys.has('completed') ? 'new-upload' : 'completed', entityKey: 'entity', state: 'ready' }),
    MEDIA_UPLOAD_BASE_TIMEOUT_MS: 90000, articleIdFromUrl: () => '42', progress: vi.fn(), Date, console, LOG: 'fixture' };
  const begin = engine.indexOf('  async function uploadImageAtMarker('), end = engine.indexOf('  function replaceMarkerText(', begin);
  const upload = new Function(...Object.keys(args), engine.slice(begin,end) + ';return uploadImageAtMarker;')(...Object.values(args));
  const result = await upload(draft, { marker: 'marker', op: { file: {} } }, new Set(['completed']), {});
  expect(result.blockKey).toBe('new-upload');
});
