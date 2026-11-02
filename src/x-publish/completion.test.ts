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
