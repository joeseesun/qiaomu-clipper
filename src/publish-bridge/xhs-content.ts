// Runs inside the Xiaohongshu creator page (injected when Obsidian hands over an article). It opens the 图文 tab, uploads the cards,
// fills the title, body and topics, and stops there: the person reviews and presses 发布 or 暂存离开 themselves.
// Selectors follow the creator centre as publicly documented by other open-source publishers (verified there 2026-03); when
// the page changes, this file is the only place to update.
const PORT_NAME = 'qiaomu-publish-xhs';
declare global { interface Window { __qiaomuPublishXhs?: boolean } }

const SEL = {
	tab: 'div.creator-tab',
	tabText: '上传图文',
	fileInput: 'input[type="file"]',
	title: 'div.d-input input, input[placeholder*="标题"], input.d-text',
	editor: 'div.tiptap.ProseMirror, div.ProseMirror[contenteditable="true"], div.ql-editor',
	previews: '.img-preview-area .pr',
	mention: '[class*="mention"] li, [class*="mention"] [role="option"], [class*="topic"] li, [role="listbox"] [role="option"], .ql-mention-list-item',
};

interface Card { base64: string; mime: string; fileName: string }
class Stopped extends Error { stopped = true; }

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const isPublishRoute = () => location.hostname === 'creator.xiaohongshu.com' && location.pathname.startsWith('/publish');
const visible = (node: Element | null): node is HTMLElement => node instanceof HTMLElement && node.offsetParent !== null && node.getBoundingClientRect().width > 0;

async function waitFor<T>(find: () => T | null | undefined | false, timeoutMs: number, step = 250, check = () => {}): Promise<T | null> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		check();
		const found = find();
		if (found) return found;
		if (Date.now() > deadline) return null;
		await sleep(step);
	}
}

function clickImageTextTab(): boolean {
	const tabs = Array.from(document.querySelectorAll<HTMLElement>(SEL.tab)).filter(visible);
	const tab = tabs.find(node => (node.textContent ?? '').trim() === SEL.tabText)
		?? Array.from(document.querySelectorAll<HTMLElement>('span, div')).filter(visible).find(node => node.children.length === 0 && (node.textContent ?? '').trim() === SEL.tabText);
	if (!tab) return false;
	tab.click();
	return true;
}

function setInputValue(input: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
	input.focus();
	setter?.call(input, value);
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	input.blur();
}

function fillEditor(editor: HTMLElement, text: string): void {
	editor.focus();
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(editor);
	selection?.removeAllRanges();
	selection?.addRange(range);
	document.execCommand('delete');
	const lines = text.split('\n');
	let typed = true;
	lines.forEach((line, index) => {
		if (index > 0) typed = document.execCommand('insertParagraph') && typed;
		if (line) typed = document.execCommand('insertText', false, line) && typed;
	});
	if (typed) return;
	// Some editor builds refuse execCommand; write paragraphs directly and let the editor pick the change up.
	editor.textContent = '';
	for (const line of lines) {
		const paragraph = document.createElement('p');
		if (line) paragraph.textContent = line; else paragraph.append(document.createElement('br'));
		editor.append(paragraph);
	}
	editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function caretToEnd(editor: HTMLElement): void {
	editor.focus();
	const range = document.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

/** Types `#话题` and picks the matching suggestion so the platform makes a real topic. Returns false when no suggestion appeared. */
async function addTopic(editor: HTMLElement, topic: string, check: () => void): Promise<boolean> {
	check();
	caretToEnd(editor);
	document.execCommand('insertParagraph');
	document.execCommand('insertText', false, `#${topic}`);
	const item = await waitFor(() => Array.from(document.querySelectorAll<HTMLElement>(SEL.mention)).filter(visible).find(node => (node.textContent ?? '').includes(topic)) ?? Array.from(document.querySelectorAll<HTMLElement>(SEL.mention)).find(visible), 2500, 250, check);
	check();
	if (!item) { document.execCommand('insertText', false, ' '); return false; }
	item.click();
	await sleep(300);
	return true;
}

async function runImport(message: { title: string; text: string; topics: string[]; cards: string[] }, pictures: Map<string, Card>, post: (message: unknown) => void, state: { cancel: boolean }): Promise<void> {
	const say = (text: string) => post({ type: 'progress', text });
	const check = () => { if (state.cancel) throw new Stopped('已停止'); };
	try {
		check();
		if (!isPublishRoute()) throw new Error('这个标签页不是小红书发布页，请先登录小红书创作平台');
		say('正在切换到「上传图文」…');
		if (!(await waitFor(() => clickImageTextTab(), 20000, 250, check))) throw new Error('没找到「上传图文」，小红书页面可能改版了');
		check();

		const files: File[] = message.cards.map((source, index) => {
			const picture = pictures.get(source);
			if (!picture) throw new Error(`第 ${index + 1} 张卡片没有准备好`);
			const bytes = Uint8Array.from(atob(picture.base64), char => char.charCodeAt(0));
			return new File([bytes], picture.fileName, { type: picture.mime });
		});
		say(`正在上传 ${files.length} 张图片…`);
		const input = await waitFor(() => Array.from(document.querySelectorAll<HTMLInputElement>(SEL.fileInput)).find(node => /image|png|jpe?g/i.test(node.accept) || !node.accept), 20000, 250, check);
		if (!input) throw new Error('没找到图片上传入口，小红书页面可能改版了');
		check();
		const transfer = new DataTransfer();
		files.forEach(file => transfer.items.add(file));
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		const titleInput = await waitFor(() => Array.from(document.querySelectorAll<HTMLInputElement>(SEL.title)).find(visible), 90000, 500, check);
		if (!titleInput) throw new Error('图片上传后没有出现标题框，可能上传失败了');
		const settled = await waitFor(() => document.querySelectorAll(SEL.previews).length >= files.length, 120000, 500, check);
		if (!settled) throw new Error(`图片尚未全部就绪（需要 ${files.length} 张，看到 ${document.querySelectorAll(SEL.previews).length} 张），请检查上传结果后重试。`);
		check();

		say('正在填写标题…');
		setInputValue(titleInput, message.title);
		await sleep(300);
		check();

		const editor = await waitFor(() => Array.from(document.querySelectorAll<HTMLElement>(SEL.editor)).find(visible), 20000, 250, check);
		if (!editor) throw new Error('没找到正文编辑框，小红书页面可能改版了');
		check();
		say('正在填写正文…');
		fillEditor(editor, message.text);
		await sleep(300);

		let missed = 0;
		for (const [index, topic] of message.topics.entries()) {
			check();
			say(`正在添加话题 ${index + 1}/${message.topics.length}…`);
			if (!(await addTopic(editor, topic, check))) missed++;
		}
		check();
		const note = missed
			? `已预填到小红书，但有 ${missed} 个话题没能变成话题标签，请在正文里手动点一下。检查后点「发布」或「暂存离开」。`
			: '已预填到小红书，请检查后点「发布」或「暂存离开」。';
		post({ type: 'done', summary: { url: location.href.split('#')[0] }, message: note });
	} catch (error) {
		if ((error as Stopped)?.stopped) { post({ type: 'cancelled' }); return; }
		post({ type: 'error', error: (error as Error).message || String(error) });
	}
}

if (!window.__qiaomuPublishXhs) {
	window.__qiaomuPublishXhs = true;
	chrome.runtime.onConnect.addListener(port => {
		if (port.name !== PORT_NAME) return;
		const pictures = new Map<string, Card>();
		const state = { cancel: false };
		let busy = false;
		const post = (message: unknown) => { try { port.postMessage(message); } catch { /* the extension went away */ } };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'ping') post({ type: 'pong', route: isPublishRoute() });
			else if (message?.type === 'image') pictures.set(String(message.source), { base64: message.base64, mime: message.mime, fileName: message.fileName });
			else if (message?.type === 'cancel') state.cancel = true;
			else if (message?.type === 'run' && !busy) { busy = true; void runImport(message, pictures, post, state).finally(() => { busy = false; }); }
		});
		port.onDisconnect.addListener(() => { state.cancel = true; });
	});
}

export {};
