import { saveConversation, deleteConversation, clearChatHistory, retryHistoryCleanup, historyCleanupStatus, listChatHistory, readConversation, type Conversation } from '../../../../src/utils/chat-history';
import { mountChatHistoryView } from '../../../../src/utils/chat-history-view';
import { watchHistoryChanges } from '../../../../src/utils/chat-history-events';
import { idbRequest, idbDone } from '../../../../src/utils/chat-history-media';
import { setUiLanguage } from '../../../../src/utils/ui-text';
setUiLanguage('zh_CN');
const prefix = 'qiaomu-cleanup-verification-chat-';
const A = 'https://example.com/reading-a', B = 'https://example.com/reading-b';
const id = (n: number) => `chat-image-00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const makeChat = (name: string, attachments: number[], generated: string[] = []): Conversation => ({ id: name, title: name, updatedAt: 0, messages: [
 { role: 'user', content: name, attachments: attachments.map(n => ({ id: id(n), name: `示例图片 ${n}.png` })) },
 { role: 'assistant', content: '公开测试内容，不包含私人对话。', generatedImages: generated.map(imageId => ({ imageId, prompt: 'test', aspect: 'auto' })) }
] });
const report: Record<string, any> = { scope: 'daily Chrome; isolated verification databases; mocked chrome.storage; production deletion and history-view modules', checks: [] };
let fault = false, running = false, view: ReturnType<typeof mountChatHistoryView> | undefined;
const originalDelete = IDBObjectStore.prototype.delete;
IDBObjectStore.prototype.delete = function (key) { if (fault && this.transaction.db.name === `${prefix}attachments`) throw new DOMException('Verification storage failure', 'UnknownError'); return originalDelete.call(this, key); };
async function db(name: string, stores: string[] = []) { return new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(prefix + name); req.onupgradeneeded = () => stores.forEach(s => req.result.createObjectStore(s)); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
async function seed(name: string, data: Record<string, Record<string, unknown>>) {
 const connection = await db(name, Object.keys(data)); try { const tx = connection.transaction(Object.keys(data), 'readwrite'), done = idbDone(tx); for (const [store, values] of Object.entries(data)) for (const [key, value] of Object.entries(values)) tx.objectStore(store).put(value, key); await done; } finally { connection.close(); }
}
async function keys(name: string, store: string) { const connection = await db(name); try { return await idbRequest(connection.transaction(store).objectStore(store).getAllKeys()); } finally { connection.close(); } }
async function snapshot() {
 return { conversations: (await listChatHistory()).items.map(i => i.id), pending: (await historyCleanupStatus()).pending,
  uploads: await keys('attachments', 'images'), previews: await keys('attachments', 'previews'), galleryImages: await keys('images', 'images'), galleryEntries: await keys('images', 'entries'), jobs: await keys('images', 'jobs'), folders: await keys('images', 'folders') };
}
async function publish() {
 report.state = await snapshot(); report.browser = navigator.userAgent;
 const body = JSON.stringify(report, null, 2); document.querySelector('#result')!.textContent = body;
 await fetch('http://127.0.0.1:18774/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}
const check = (name: string, success: boolean) => { report.checks.push({ name, passed: success }); if (!success) throw new Error(name); };
async function seedChats(suffix = '') {
 await seed('attachments', { images: { [id(1)]: new Blob(['private upload']), [id(2)]: new Blob(['shared upload']) }, previews: { [id(1)]: new Blob(['preview 1']), [id(2)]: new Blob(['preview 2']) } });
 await seed('images', { images: { library: new Blob(['gallery-owned']), job: new Blob(['job-owned']), orphan: new Blob(['chat-only']) }, entries: { library: { id: 'library', source: 'generated' } }, jobs: { generation: { id: 'generation', imageId: 'job' } }, folders: { existing: { id: 'existing', name: '保留的图库目录' } } });
 await saveConversation(A, '网页 A', makeChat('网页 A：文字和独占图片' + suffix, [1, 2], ['library', 'job', 'orphan']));
 await saveConversation(B, '网页 B', makeChat('网页 B：继续使用共用图片' + suffix, [2]));
}
function mount() {
 view?.destroy(); const root = document.querySelector<HTMLDivElement>('#history')!, trigger = document.querySelector<HTMLButtonElement>('#history-button')!; root.replaceChildren(); root.hidden = true;
 view = mountChatHistoryView(root, trigger, { beforeOpen() {}, onOpen(chat) { document.querySelector('#selection')!.textContent = chat.title; }, onDelete: i => deleteConversation(i.source.url, i.id, i.source.preserveUrlHash), onClear: clearChatHistory, isCurrent: () => false }); trigger.onclick = () => view!.toggle(); view.toggle();
}
async function run() {
 fault = false; running = true; view?.destroy(); report.checks = []; delete report.error;
 for (const name of ['history', 'attachments', 'images']) await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(prefix + name); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('Verification database busy')); });
 await seedChats(); await deleteConversation(A, '网页 A：文字和独占图片'); let current = await snapshot();
 check('单条删除清除正文和摘要', !(await readConversation(A, '网页 A：文字和独占图片')) && current.conversations.length === 1);
 check('独占图片及缩略图已删除，共用图片保留', JSON.stringify(current.uploads) === JSON.stringify([id(2)]) && JSON.stringify(current.previews) === JSON.stringify([id(2)]));
 check('独立图库、任务和文件夹均保留，仅孤立图片删除', JSON.stringify(current.galleryImages) === JSON.stringify(['job', 'library']) && current.galleryEntries.length === 1 && current.jobs.length === 1 && current.folders.length === 1);
 fault = true; let failed = false; try { await clearChatHistory(); } catch { failed = true; }
 current = await snapshot(); check('清空失败保留待清理任务，没有伪报完成', failed && current.pending === 1 && current.conversations.length === 0 && current.uploads.length === 1);
 await saveConversation(A, '新网页', makeChat('失败后新建的对话', [2])); fault = false; await retryHistoryCleanup(); current = await snapshot();
 check('重试保留失败后新建的对话及其图片', current.pending === 0 && current.conversations.includes('失败后新建的对话') && current.uploads.length === 1);
 await clearChatHistory(); current = await snapshot(); check('清空全部历史及闲置附件，图库仍保留', current.conversations.length === 0 && current.uploads.length === 0 && current.previews.length === 0 && current.galleryEntries.length === 1 && current.galleryImages.length === 2);
 await seedChats('（手动验证）'); mount(); running = false; await publish();
}
(document.querySelector('#run') as HTMLButtonElement).onclick = () => { void run().catch(error => { running = false; report.error = String(error); document.querySelector('#result')!.textContent = JSON.stringify(report, null, 2); }); };
(document.querySelector('#fault') as HTMLButtonElement).onclick = () => { fault = !fault; document.querySelector('#fault')!.textContent = fault ? '恢复图片存储' : '模拟图片清理失败'; };
watchHistoryChanges(() => { setTimeout(() => { if (!running) void publish(); }, 50); });
if (new URL(location.href).searchParams.has('restore')) { mount(); void publish(); } else document.querySelector('#run')!.textContent = '运行隔离验证';
