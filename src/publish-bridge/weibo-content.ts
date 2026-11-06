// Runs inside weibo.com (injected when Obsidian hands over a note). It fills the composer with the body text, the #话题# topics and
// the pictures, then stops: the person reviews and presses 发送 themselves. The composer is a plain textarea, so this does not
// depend on the rich-text editor build; when Weibo changes the page, this file is the only place to update.
const PORT_NAME = 'qiaomu-publish-weibo';
declare global { interface Window { __qiaomuPublishWeibo?: boolean } }

const SEL = {
	composer: 'textarea[placeholder*="新鲜事"], textarea[placeholder*="分享"], textarea[placeholder*="说点"], textarea',
	fileInput: 'input[type="file"]',
	remove: 'i[title="删除"]',
	loading: '[class*="Image_loading"], [class*="uploading"]',
};

interface Picture { base64: string; mime: string; fileName: string; bytes: number }
class Stopped extends Error { stopped = true; }

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const isComposeRoute = () => ['weibo.com', 'www.weibo.com'].includes(location.hostname);
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

function findComposer(): HTMLTextAreaElement | null {
	const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>(SEL.composer)).filter(visible);
	return candidates.find(node => (node.placeholder ?? '').includes('新鲜事'))
		?? candidates.find(node => node.closest('[class*="Form"], [class*="compose"], [class*="editor"]'))
		?? candidates[0]
		?? null;
}

/** Writes into the composer the way a person would, so the page's own state (counter, topic parsing) updates. */
function setComposerValue(composer: HTMLTextAreaElement, value: string): void {
	composer.focus();
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
	setter?.call(composer, value);
	composer.dispatchEvent(new Event('input', { bubbles: true }));
	composer.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The picture input belongs to the composer; the page has other file inputs (avatar, background) we must not touch. */
function findFileInput(composer: HTMLTextAreaElement): HTMLInputElement | null {
	const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(SEL.fileInput))
		.filter(node => !node.accept || /image|jpe?g|png|gif|webp/i.test(node.accept));
	const near = inputs.find(node => {
		let parent: HTMLElement | null = composer.parentElement;
		for (let depth = 0; depth < 8 && parent; depth += 1, parent = parent.parentElement) {
			if (parent.contains(node)) return true;
		}
		return false;
	});
	return near ?? inputs[0] ?? null;
}

async function runFill(message: { text: string; topics: string[]; images: string[] }, pictures: Map<string, Picture>, post: (message: unknown) => void, state: { cancel: boolean }): Promise<void> {
	const say = (text: string) => post({ type: 'progress', text });
	const check = () => { if (state.cancel) throw new Stopped('已停止'); };
	try {
		check();
		if (!isComposeRoute()) throw new Error('这个标签页不是微博发布页，请先登录微博');
		say('正在寻找微博发布框…');
		const composer = await waitFor(findComposer, 20000, 250, check);
		if (!composer) throw new Error('没找到微博输入框，请确认已登录微博；微博页面可能改版了');
		check();

		say('正在填写正文…');
		const topicLine = message.topics.map(topic => `#${topic}#`).join(' ');
		setComposerValue(composer, topicLine ? `${message.text.trim()}\n${topicLine}` : message.text.trim());
		await sleep(300);
		check();

		if (message.images.length) {
			const files: File[] = message.images.map((source, index) => {
				const picture = pictures.get(source);
				if (!picture) throw new Error(`第 ${index + 1} 张图片没有准备好`);
				const bytes = Uint8Array.from(atob(picture.base64), char => char.charCodeAt(0));
				return new File([bytes], picture.fileName, { type: picture.mime });
			});
			say(`正在上传 ${files.length} 张图片…`);
			const input = await waitFor(() => findFileInput(composer), 20000, 250, check);
			if (!input) throw new Error('没找到图片上传入口，微博页面可能改版了');
			check();
			const transfer = new DataTransfer();
			files.forEach(file => transfer.items.add(file));
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));

			const previews = await waitFor(() => {
				const count = document.querySelectorAll(SEL.remove).length;
				return count >= files.length ? count : null;
			}, 120000, 500, check);
			if (!previews) throw new Error(`图片尚未全部就绪（需要 ${files.length} 张，看到 ${document.querySelectorAll(SEL.remove).length} 张），请在微博里检查后重试。`);
			check();
			say('正在等待图片上传完成…');
			const settled = await waitFor(() => document.querySelectorAll(SEL.loading).length === 0, 90000, 500, check);
			if (!settled) throw new Error('图片上传还没有完成，请在微博发布框里等它转完再试。');
			check();
		}

		post({ type: 'done', summary: { url: location.href.split('#')[0] }, message: '已填入微博发布框，请检查后点「发送」。' });
	} catch (error) {
		if ((error as Stopped)?.stopped) { post({ type: 'cancelled' }); return; }
		post({ type: 'error', error: (error as Error).message || String(error) });
	}
}

if (!window.__qiaomuPublishWeibo) {
	window.__qiaomuPublishWeibo = true;
	chrome.runtime.onConnect.addListener(port => {
		if (port.name !== PORT_NAME) return;
		const pictures = new Map<string, Picture>();
		const state = { cancel: false };
		let busy = false;
		const post = (message: unknown) => { try { port.postMessage(message); } catch { /* the extension went away */ } };
		port.onMessage.addListener((message: any) => {
			if (message?.type === 'ping') post({ type: 'pong', route: isComposeRoute() });
			else if (message?.type === 'image') pictures.set(String(message.source), { base64: message.base64, mime: message.mime, fileName: message.fileName, bytes: message.bytes });
			else if (message?.type === 'cancel') state.cancel = true;
			else if (message?.type === 'run' && !busy) { busy = true; void runFill(message, pictures, post, state).finally(() => { busy = false; }); }
		});
		port.onDisconnect.addListener(() => { state.cancel = true; });
	});
}

export {};
