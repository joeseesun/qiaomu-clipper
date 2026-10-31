import { h } from '../write/editor/dom';
import { t } from '../utils/ui-text';
import { loadWebSearch, saveWebSearch, searchWeb, searchFailure, type SearchProvider } from '../utils/web-search';

export async function openWebSearchSettings(onSaved?: () => void): Promise<void> {
	const config = await loadWebSearch();
	const drafts = { ...config.keys };
	const dialog = h('dialog', { class: 'qm-search-settings', 'aria-label': t('联网搜索') });
	const service = h('select', { 'aria-label': t('搜索服务') });
	for (const [id, name] of [['deepseek', 'DeepSeek Search'], ['brave', 'Brave Search']]) service.append(h('option', { value: id, text: name }));
	service.value = config.provider;
	const key = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'API Key', placeholder: 'API Key' });
	const link = h('a', { target: '_blank', rel: 'noopener noreferrer', text: t('获取密钥') });
	const note = h('p'), status = h('p', { class: 'qm-search-status', role: 'status' });
	const enabled = h('input', { type: 'checkbox' }); enabled.checked = config.enabled;
	let selected = config.provider, alive = true, controller: AbortController | undefined;
	const refresh = () => { key.value = drafts[selected]; remove.hidden = !config.keys[selected]; link.href = selected === 'deepseek' ? 'https://platform.deepseek.com/api_keys' : 'https://api-dashboard.search.brave.com/'; note.textContent = selected === 'deepseek' ? t('搜索网页并读取正文，供当前聊天模型回答。') : t('搜索网页，供当前聊天模型回答。'); };
	service.onchange = () => { drafts[selected] = key.value.trim(); selected = service.value as SearchProvider; status.textContent = ''; refresh(); };
	const close = () => { alive = false; controller?.abort(); dialog.close(); dialog.remove(); };
	dialog.oncancel = event => { event.preventDefault(); close(); };
	const cancel = h('button', { type: 'button', text: t('取消'), onclick: close });
	const save = h('button', { type: 'button', class: 'primary', text: t('验证并保存') });
	const remove = h('button', { type: 'button', text: t('移除密钥') });
	refresh();
	remove.onclick = () => {
		config.keys[selected] = ''; key.value = ''; config.provider = selected;
		void saveWebSearch(config).then(() => { if (alive) { close(); onSaved?.(); } }).catch(error => { status.textContent = searchFailure(error); });
	};
	save.onclick = () => {
		config.keys[selected] = key.value.trim(); config.provider = selected; config.enabled = enabled.checked;
		if (!config.keys[selected]) { status.textContent = t('请填写 API Key'); return; }
		controller = new AbortController(); const signal = controller.signal;
		save.disabled = service.disabled = remove.disabled = key.disabled = true; status.textContent = t('正在验证搜索服务…');
		void searchWeb('Obsidian official website', { ...config, enabled: true }, signal).then(async rows => {
			if (!rows.length) throw new Error(t('服务没有返回搜索结果，请检查后重试。'));
			if (!alive || signal.aborted) return;
			await saveWebSearch(config);
			if (alive) { close(); onSaved?.(); }
		}).catch(error => { if (alive) status.textContent = searchFailure(error); }).finally(() => { if (alive) save.disabled = service.disabled = remove.disabled = key.disabled = false; });
	};
	dialog.append(h('h2', { text: t('联网搜索') }), h('p', { text: t('支持原生工具的 Token Plan 模型直接使用已配置的模型密钥，无需在这里填写搜索密钥。聊天中的联网开关同时控制原生搜索、抓取和搜图。') }), h('label', {}, t('搜索服务'), service), note, h('label', {}, 'API Key', key), link,
		h('label', { class: 'qm-search-enabled' }, enabled, t('需要时自动搜索')), status, h('footer', {}, remove, cancel, save));
	document.body.append(dialog); dialog.showModal(); key.focus();
}
export async function initializeWebSearchSettings(): Promise<void> {
	const root = document.getElementById('web-search-home'); if (!root) return;
	const config = await loadWebSearch();
	root.replaceChildren();
	root.append(h('p', { text: t('支持原生工具的 Token Plan 模型直接使用已配置的模型密钥，无需在这里填写搜索密钥。聊天中的联网开关同时控制原生搜索、抓取和搜图。') }));
	const connected = Object.entries(config.keys).filter(([, key]) => key).map(([id]) => `${id === 'deepseek' ? 'DeepSeek Search' : 'Brave Search'}${id === config.provider ? ` (${t('默认')})` : ''}`).join(' · ');
	root.append(h('p', { text: connected || t('连接搜索服务，让助手查找最新资料并提供来源。') }),
		h('button', { type: 'button', text: t('配置搜索服务'), onclick: () => void openWebSearchSettings(() => void initializeWebSearchSettings()) }));
}
