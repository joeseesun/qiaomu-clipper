// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { readFileStudySession, saveFileStudySession } from './file-study-session';
const KEY = 'file:' + 'a'.repeat(32);
beforeEach(() => sessionStorage.clear());
it('restores metadata only in the matching tab route, never stores media or credentials', () => {
	expect(saveFileStudySession('reader?token=one', KEY, 'Lecture')).toBe(true);
	expect(readFileStudySession('reader?token=one')).toMatchObject({ key: KEY, title: 'Lecture' });
	expect(readFileStudySession('reader?token=two')).toBeUndefined();
	expect(Object.keys(JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')!)).sort()).toEqual(['at', 'key', 'pending', 'route', 'title']);
});
it('rejects invalid, expired and malformed session metadata', () => {
	for (const saved of [null, { route:'r', key:'../../private', title:'t', at:Date.now() }, { route:'r', key:KEY, title:'t', at:0 }]) {
		sessionStorage.setItem('qiaomuFileStudySession', JSON.stringify(saved)); expect(readFileStudySession('r')).toBeUndefined();
	}
	sessionStorage.setItem('qiaomuFileStudySession', '{'); expect(readFileStudySession('r')).toBeUndefined();
});
it('reports unavailable session storage without losing a completed recognition', () => {
	const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
	expect(saveFileStudySession('r', KEY, 't')).toBe(false); spy.mockRestore();
});

it('retains only a valid task ID, including legacy sessions with no ID', () => {
 const id='c'.repeat(32);
 saveFileStudySession('r',KEY,'lecture',true,id);
 expect(readFileStudySession('r')).toMatchObject({pending:true,jobId:id});
 for (const jobId of ['../private','x'.repeat(32),42,null]) {
  sessionStorage.setItem('qiaomuFileStudySession',JSON.stringify({route:'r',key:KEY,title:'lecture',at:Date.now(),pending:true,jobId}));
  expect(readFileStudySession('r')?.jobId).toBeUndefined();
 }
});
