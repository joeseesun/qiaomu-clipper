import { listChatHistory, saveConversation } from '../../../src/utils/chat-history';
import { mountClipChat } from '../../../src/utils/clip-chat';
import { setUiLanguage } from '../../../src/utils/ui-text';
const pause = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const status = document.getElementById('status')!;
let ui: ReturnType<typeof mountClipChat> | undefined;
async function reset() {
 ui?.destroy(); ui = undefined;
 await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase('qiaomu-chat-history'); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
}
function mount() {
 ui = mountClipChat({ getContext: () => ({ url: 'https://example.com/event-loop', title: '当前页面：事件循环', markdown: 'This live page text must not enter history.' }) });
 ui.toggle(true);
}
async function openHistory() {
 document.querySelector<HTMLButtonElement>('[aria-controls^="chat-history-"]')!.click();
 while (!document.querySelector('.clip-chat-history-open')) await pause();
}
async function demo() {
 await reset();
 await saveConversation('https://example.com/browser-storage', '浏览器本地存储', { id: 'storage-example', title: '如何保留对话，同时减少浏览器负担？', updatedAt: 0, messages: [
  { role: 'user', content: '如何保留对话，同时减少浏览器负担？' },
  { role: 'assistant', content: '可以把**对话记录**和**原网页链接**保存在浏览器本地。\n\n- 历史列表只读取摘要，按页显示。\n- 选中一段对话，再读取它的消息。\n- 长对话先显示最近的消息，较早内容按需展开。\n- 查看历史时无需请求模型，也无需读取原网页。\n\n长期保留仍会占用磁盘；这是一种控制读取和渲染开销的方式。' },
  { role: 'user', content: '原网页关闭后还能看到吗？' },
  { role: 'assistant', content: '能查看已经保存的问答。底部链接会带你回到原网页，再使用当前网页内容继续聊天。' }
 ] });
 await saveConversation('https://example.com/async-notes', '异步任务学习笔记', { id: 'async-example', title: '任务与微任务的顺序', updatedAt: 0, messages: [{ role: 'user', content: '任务与微任务如何排序？' }, { role: 'assistant', content: '这是一段公开的合成对话，用于展示跨页面历史列表。' }] });
 mount(); await pause(); await openHistory(); status.textContent = '3 个网页场景，2 段合成对话。点击“浏览器本地存储”查看历史。没有配置模型，也不会发送模型请求。';
}
async function benchmark() {
 await reset(); await listChatHistory();
 const db: IDBDatabase = await new Promise((resolve, reject) => { const req = indexedDB.open('qiaomu-chat-history'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
 for (let batch = 0; batch < 20; batch++) {
  const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
  for (let j = 0; j < 100; j++) {
   const n = batch * 100 + j, id = `fixture-${n}`, pageKey = `https://example.com/${n}`;
   const source = { url: pageKey, title: `性能测试网页 ${n}`, preserveUrlHash: false };
   const messages = Array.from({ length: n === 1999 ? 600 : 4 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: (i % 2 ? '这是合成历史回答。' : '这是合成历史问题。').repeat(30) }));
   const conversation = { id, title: `性能测试对话 ${n}`, updatedAt: n, revision: 1, source, messages };
   tx.objectStore('conversations').put({ id, pageKey, conversation });
   tx.objectStore('summaries').put({ id, pageKey, title: conversation.title, updatedAt: n, source, messageCount: messages.length });
  }
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); await pause();
 }
 db.close(); const queries = [];
 for (let i = 0; i < 5; i++) { const at = performance.now(), result = await listChatHistory(); queries.push({ ms: performance.now() - at, rows: result.items.length, bodyLoaded: result.items.some(row => 'messages' in row) }); }
 mount(); await pause(); await pause();
 const started = performance.now(); await openHistory(); const listRenderMs = performance.now() - started;
 const selected = performance.now(); document.querySelector<HTMLButtonElement>('.clip-chat-history-open')!.click();
 while (document.querySelector<HTMLElement>('.clip-chat-history-resume')!.hidden) await pause();
 const report = { synthetic: true, storedChats: 2000, selectedChatMessages: 600, queries, listRenderMs, conversationRenderMs: performance.now() - selected, renderedMessages: document.querySelectorAll('.clip-chat-message').length, readonly: document.querySelector<HTMLFormElement>('.clip-chat-composer')!.hidden, remoteImages: document.querySelectorAll('.clip-chat-messages img[src^="http"]').length, heapBytes: (performance as any).memory?.usedJSHeapSize };
 status.textContent = JSON.stringify(report, null, 2);
 await fetch('/benchmark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
}
setUiLanguage('zh_CN');
for (const [id, action] of [['demo', demo], ['benchmark', benchmark], ['cleanup', reset]] as const) document.getElementById(id)!.onclick = () => { void action().catch(error => { status.textContent = String(error); }); };
void demo().catch(error => { status.textContent = String(error); });
