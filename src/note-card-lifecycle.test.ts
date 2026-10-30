// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const notes = vi.hoisted(() => ({ open: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() }));
vi.mock('./utils/learning-composer', () => ({ mountLearningNotes: () => notes }));
vi.mock('./utils/storage-utils', () => ({ loadSettings: vi.fn().mockResolvedValue({}) }));
afterEach(() => { window.qiaomuNoteCardDispose?.(); delete window.qiaomuNoteCardDispose; delete window.qiaomuNoteCardGeneration; vi.unstubAllGlobals(); });
it('reopens III with a new runtime after reinjection and retires the old message listener', async () => {
 const inject = async () => {
  vi.resetModules(); const listeners = new Set<Function>();
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: (fn: Function) => listeners.add(fn), removeListener: (fn: Function) => listeners.delete(fn) } } });
  await import('./note-card-content'); for (let i = 0; i < 10; i++) await Promise.resolve();
  return listeners;
 };
 const old = await inject(); notes.open.mockClear(); notes.dispose.mockClear(); const fresh = await inject();
 expect(notes.open).toHaveBeenCalledTimes(1); expect(notes.dispose).toHaveBeenCalledTimes(1); expect(old.size).toBe(0); expect(fresh.size).toBe(1);
 notes.open.mockClear(); const reply = vi.fn(); fresh.forEach(fn => fn({ action: 'qiaomuOpenNote' }, {}, reply));
 for (let i = 0; i < 10; i++) await Promise.resolve();
 expect(reply).toHaveBeenCalledWith(true); expect(notes.open).toHaveBeenCalledTimes(1);
});
