import browser from './browser-polyfill';
import { h } from '../write/editor/dom';
import { t } from './ui-text';
import { xInstaller, xDownloadSize } from './x-setup-release';
import { checkXSetupConnection } from './x-setup-network';
import type { XSetupProblem } from './x-setup-state';
import '../styles/x-setup.scss';

export function setupError(error: unknown): string {
	const code = error instanceof Error ? error.message : String(error);
	if (/integrity/.test(code)) return t('下载校验失败，请重新安装。');
	if (/login/.test(code)) return t('登录未完成，请重试并在浏览器中确认。');
	if (/timeout/.test(code)) return t('操作超时，请检查网络后重试。');
	if (/busy/.test(code)) return t('助手正在处理其他任务，请稍后重试。');
	if (/platform/.test(code)) return t('此系统暂未提供一键安装包。');
	if (/download/.test(code)) return t('X 阅读组件下载未完成。请检查能否访问 x.ai 后重试；已安装的助手可以继续使用。');
	return t('操作未完成，请检查网络后重试。');
}

async function call(action: string, fields: Record<string, unknown> = {}): Promise<any> {
	const reply: any = await browser.runtime.sendMessage({ action, ...fields });
	if (!reply?.ok) throw new Error(reply?.error || 'helper-offline');
	return reply;
}

// One dialog per document. Closing it stops polling and cancels only operations
// started here. Returning from the OS installer triggers an immediate check.
let current: (() => void) | undefined;
export async function openXSetup(resume?: () => void, problem?: XSetupProblem): Promise<void> {
	current?.();
	const dialog = h('dialog', { class: 'qm-x-setup', 'aria-label': t('X 完整阅读') });
	const networkController = new AbortController();
	const networkNote = h('p', { class: 'qm-x-setup-note', role: 'status', 'aria-live': 'polite' });
	const size = h('p', { class: 'qm-x-setup-note' });
	let downloadSize = xDownloadSize('mac', 'x86-64');
	const requirements = h('details', { class: 'qm-x-setup-requirements', open: true },
		h('summary', { text: t('使用条件') }),
		h('p', { text: t('网络：这台电脑需要能访问 X 和 Grok（x.ai）。') }),
		h('p', { text: t('账号：需准备可用于 Grok 的账号及访问权限，设置时在官方网页确认。') }), size,
		h('div', { class: 'qm-x-setup-links' },
			h('a', { href: 'https://x.com', target: '_blank', rel: 'noopener noreferrer', text: 'X' }),
			h('a', { href: 'https://x.ai', target: '_blank', rel: 'noopener noreferrer', text: 'Grok' })));
	const setup = h('div', { hidden: true });
	const helper = h('p', { role: 'status', 'aria-live': 'polite', text: t('正在检查…') });
	const grok = h('p', { role: 'status', 'aria-live': 'polite' });
	const note = h('p', { class: 'qm-x-setup-note', role: 'status', 'aria-live': 'polite' });
	const download = h('a', { class: 'qm-x-setup-primary', target: '_blank', rel: 'noopener noreferrer', text: t('安装或更新本地助手'), hidden: true });
	const local = h('p', { class: 'qm-x-setup-note', hidden: true });
	const progress = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': t('正在安装…') });
	let alive = true, checking = false, working = false, setupStarted = false, networkChecking = false, timer: ReturnType<typeof setTimeout> | undefined;
	let job: string | undefined, owned: string | undefined, needsLogin = problem === 'login', authenticated = false, expired = false;
	let deadline = Date.now() + 15 * 60_000;
	const cancel = (id: string) => { void call('xSetupCancel', { id }).catch(() => {}); };
	const close = () => {
		if (!alive) return;
		alive = false; networkController.abort(); clearTimeout(timer); if (owned) cancel(owned);
		window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh);
		dialog.close(); dialog.remove(); if (current === close) current = undefined;
	};
	current = close;
	const defer = h('button', { type: 'button', 'data-x-setup-close': true, text: t('暂不启用'), onclick: close });
	const begin = h('button', { type: 'button', class: 'qm-x-setup-primary', text: t('检查连接并设置'), onclick: () => void beginSetup() });
	const install = h('button', { type: 'button', class: 'qm-x-setup-primary', hidden: true, onclick: () => void start('install') });
	const login = h('button', { type: 'button', hidden: true, text: t('在浏览器登录 Grok'), onclick: () => void start('login') });
	const stop = h('button', { type: 'button', text: t('取消'), hidden: true, onclick: () => { if (job) cancel(job); } });
	const next = h('button', { type: 'button', class: 'qm-x-setup-primary', text: t('继续原来的请求'), hidden: true, disabled: true,
		onclick: () => { close(); resume?.(); } });
	const recheck = h('button', { type: 'button', text: t('重新检查'), hidden: true, onclick: refresh });
	async function beginSetup() {
		if (!alive || networkChecking) return;
		networkChecking = true; begin.disabled = true; networkNote.textContent = t('正在检查 Grok 连接…');
		const connected = await checkXSetupConnection(networkController.signal);
		if (!alive) return;
		networkChecking = false; begin.disabled = false;
		if (!connected) { networkNote.textContent = t('暂时无法连接 Grok。请确认这台电脑能打开 x.ai，再重试；不会开始下载。'); return; }
		networkNote.textContent = ''; begin.hidden = true; requirements.open = false;
		setupStarted = true; setup.hidden = false; recheck.hidden = false;
		defer.textContent = t('关闭');
		await check();
	}
	const renderBusy = () => {
		install.disabled = login.disabled = working; stop.hidden = !working;
		if (working) { next.disabled = true; next.hidden = true; }
	};
	async function start(operation: 'install' | 'login') {
		if (working || !alive) return;
		job = owned = crypto.randomUUID(); working = true; renderBusy(); note.textContent = t('正在准备…');
		const id = job;
		try {
			await call('xSetupStart', { id, operation });
			if (!alive) { cancel(id); return; }
			if (operation === 'install') needsLogin = true;
			void check();
		} catch (error) { if (alive) { job = owned = undefined; working = false; note.textContent = setupError(error); renderBusy(); } }
	}
	async function check() {
		if (!alive || !setupStarted || checking || document.hidden) return;
		checking = true; clearTimeout(timer);
		try {
			const status = await call('xSetupStatus');
			if (!alive) return;
			if (status.xSetup !== 1 || status.xArticles !== 1) throw new Error('helper-upgrade-required');
			helper.textContent = t('本地助手已连接：{0}', [status.version || '']); download.hidden = local.hidden = true;
			job ||= status.job?.id;
			working = Boolean(job);
			if (job) {
				const state = await call('xSetupPoll', { id: job }).catch(error => ({ state: 'failed', error }));
				if (!alive) return;
				progress.hidden = state.state !== 'downloading'; progress.value = Number(state.progress) || 0;
				if (state.state === 'ready') {
					if (state.operation === 'login') { needsLogin = false; authenticated = true; }
					job = owned = undefined; working = false; note.textContent = t('已完成');
				} else if (['failed', 'cancelled'].includes(state.state)) {
					job = owned = undefined; working = false;
					note.textContent = state.state === 'cancelled' ? t('已取消') : setupError(state.error);
				} else note.textContent = state.state === 'signing-in' ? t('请在打开的官方网页中完成登录。') : t('正在安装…');
			}
			grok.textContent = status.grokAvailable ? (needsLogin ? t('Grok 需要登录。') : t('Grok 已就绪，可重试读取；账号失效时会提示登录。')) : t('安装 Grok 后，助手可以继续定位 X 长文。');
			install.hidden = status.grokAvailable || !status.setupSupported;
			login.hidden = !status.grokAvailable || authenticated;
			login.classList.toggle('qm-x-setup-primary', needsLogin || !resume);
			if (authenticated && !resume) { defer.textContent = t('完成'); defer.classList.add('qm-x-setup-primary'); }
			if (!status.setupSupported && !status.grokAvailable) note.textContent = t('此系统暂未提供一键安装包。');
			next.disabled = !status.grokAvailable || needsLogin || working;
			next.hidden = !resume || next.disabled;
			renderBusy();
		} catch (error) {
			if (!alive) return;
			helper.textContent = t('请安装或更新本地助手后重试；每台电脑都需要安装一次。');
			grok.textContent = ''; install.hidden = login.hidden = true; next.disabled = true; next.hidden = true;
			try {
				const platform = await browser.runtime.getPlatformInfo();
				if (!alive) return;
				const installer = xInstaller(platform.os, platform.arch);
				download.hidden = !installer?.url; if (installer?.url) download.href = installer.url;
				local.hidden = Boolean(installer?.url);
				local.textContent = installer ? t('请打开随本版本提供的安装包：{0}。安装后回到这里，会自动检测。', [installer.file]) : t('此系统暂未提供一键安装包。');
			} catch { note.textContent = setupError(error); }
		} finally {
			checking = false;
			if (alive && !expired) {
				if (Date.now() > deadline) { expired = true; note.textContent = t('自动检测已暂停，请点击重新检查。'); }
				else timer = setTimeout(() => void check(), 1500);
			}
		}
	}
	function refresh() { if (!document.hidden) { deadline = Date.now() + 15 * 60_000; expired = false; void check(); } }
	dialog.oncancel = event => { event.preventDefault(); close(); };
	setup.append(helper, download, local, grok, h('div', { class: 'qm-x-setup-actions' }, install, login, stop), progress, note,
		h('p', { class: 'qm-x-setup-note', text: t('每台电脑设置一次，无需安装 Python 或输入命令。') }),
		h('p', { class: 'qm-x-setup-note', text: t('登录信息由 Grok 保存在本机。关闭此窗口会取消本次安装或登录。') }));
	dialog.append(h('h2', { text: t('X 完整阅读') }), h('p', { text: t('读取 X 长文并翻译，保留代码、图片和原文结构。') }),
		h('p', { class: 'qm-x-setup-note', text: t('暂不启用不影响其他功能，可随时从“可选功能”回来设置。') }),
		requirements, networkNote, setup,
		h('div', { class: 'qm-x-setup-actions qm-x-setup-footer' }, defer, recheck, begin, next));
	document.body.append(dialog); dialog.showModal();
	window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
	try { const platform = await browser.runtime.getPlatformInfo(); downloadSize = xDownloadSize(platform.os, platform.arch); } catch { /* conservative estimate */ }
	size.textContent = t('下载：首次最多约 {0} MB；已有组件会直接复用。', [downloadSize.total]);
	install.textContent = t('下载 X 阅读组件（约 {0} MB）', [downloadSize.component]);
}
