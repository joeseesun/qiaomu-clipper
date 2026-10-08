import { LOCAL_ENGINES, MAX_PROFILES, PROVIDERS, choosePatch, cloudConfig, defaultRecognizer, iconOf, isConfigured, isHttpsOrLocal, isLocalService, loadAsrSettings, newProfile, profileLabel, providerOf, recognizerFor, removeProfile, saveAsrSettings, saveProfile, withProvider, type AsrPlatform, type AsrProfile, type AsrProtocol, type AsrProviderId, type AsrSettings, type Recognizer } from '../utils/asr-settings';
import { asrInstall, asrInstallCancel, asrInstallPoll, asrStatus, asrTest, asrUninstall, type AsrInstall, type AsrLocalEngine, type InstallTarget } from '../utils/asr-client';
import { installProblem } from '../utils/subtitle-generation';
import { updateToggleState } from '../utils/ui-utils';

// "Speech recognition" in the video settings. A default way of recognising that applies everywhere, each site able to use its own,
// and a grid of the ways there are: local engines (installed from here) and cloud services (set up in a dialog), each with a dot
// that is green once it is ready to use. Nothing is edited in place: a card opens its dialog, and the dialog saves.
const size = (mb: number) => mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB';
const SITES: Array<[AsrPlatform, string]> = [['youtube', 'YouTube'], ['bilibili', '哔哩哔哩'], ['xiaoyuzhou', '播客'], ['file', '本地文件'], ['web', '其他网站']];
// What to suggest first, so a newcomer has two clear starts and nothing else to weigh: one local engine, and the two cloud services tried and found fast and accurate.
const RECOMMENDED_CLOUD: Array<[AsrProviderId, string]> = [['doubao', '速度最快，时间轴最准'], ['siliconflow', 'Qwen3-ASR，中文术语识别准确']];
const shortName = (id: AsrProviderId) => providerOf(id).label.split(/[\s（(]/)[0];
type Installing = { engine: InstallTarget; jobId: string; stage: string; progress: number } | undefined;

export async function initializeAsrSettings(): Promise<void> {
	const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
	const useContext = el<HTMLInputElement>('asr-use-context'), defaultSelect = el<HTMLSelectElement>('asr-default'), routes = el('asr-routes'), rec = el('asr-rec'), grid = el('asr-grid'), addButton = el<HTMLButtonElement>('asr-add'), status = el('asr-status'), autoStart = el<HTMLInputElement>('asr-auto-start');
	const modal = el('asr-modal'), modalTitle = el('asr-modal-title'), modalBody = el('asr-modal-body'), modalActions = el('asr-modal-actions');
	if (!defaultSelect || !routes || !rec || !grid || !addButton || !status || !modal || !modalTitle || !modalBody || !modalActions) return;
	let settings: AsrSettings = await loadAsrSettings();
	let engines: AsrLocalEngine[] | undefined, helperProblem = '', installing: Installing, onClose: (() => void) | undefined, redraw: (() => void) | undefined;

	const say = (text: string) => { status.textContent = text; };
	const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const item = document.createElement(tag); if (className) item.className = className; if (text) item.textContent = text; return item; };
	const icon = (id: string) => { const info = iconOf(id), item = node('span', 'asr-icon', info.text); item.style.setProperty('--h', String(info.hue)); item.setAttribute('aria-hidden', 'true'); return item; };

	// ---- what exists --------------------------------------------------------------------------------------------------
	const localInfo = (id: string) => engines?.find(item => item.id === id);
	// Until the helper answers every engine is listed; afterwards only the ones this computer can run.
	const localList = () => LOCAL_ENGINES.filter(item => engines === undefined || localInfo(item.id)?.supported !== false);
	const options = (): Array<[Recognizer, string]> => [
		['local:auto', '本机 · 自动（用已安装的最快的）'],
		...localList().map(item => [`local:${item.id}`, `本机 · ${item.name}${localInfo(item.id)?.installed ? '' : '（未安装）'}`] as [Recognizer, string]),
		...settings.profiles.map(item => [`cloud:${item.id}`, `云端 · ${profileLabel(item, settings.profiles)}${isConfigured(item) ? '' : '（未填完）'}`] as [Recognizer, string]),
	];
	const fill = (select: HTMLSelectElement, list: Array<[string, string]>, value: string) => {
		select.replaceChildren(...list.map(([v, label]) => { const option = node('option', '', label); option.value = v; return option; }));
		select.value = list.some(([v]) => v === value) ? value : list[0]?.[0] ?? '';
	};

	// ---- the page -----------------------------------------------------------------------------------------------------
	const routeWith = (platform: AsrPlatform, value: string) => { const next = { ...settings.routes }; if (value) next[platform] = value; else delete next[platform]; return next; };
	const paintDefaults = () => {
		fill(defaultSelect, options(), defaultRecognizer(settings));
		const nowLabel = document.getElementById('asr-current-label'), nowNote = document.getElementById('asr-current-note'), defaultNote = document.getElementById('asr-default-note');
		if (defaultNote) defaultNote.textContent = defaultSelect.value.startsWith('cloud') ? '云端模型：音频会上传，按量计费。' : '本机模型：免费，音频不离开这台电脑。';
		if (nowLabel) { nowLabel.textContent = defaultSelect.selectedOptions[0]?.textContent ?? ''; if (nowNote) nowNote.textContent = defaultSelect.value.startsWith('cloud') ? ' · 音频会上传，按量计费' : ' · 音频不上传'; }
		routes.replaceChildren(...SITES.map(([platform, label]) => {
			const wrap = node('div', 'asr-field'), caption = node('label', '', label), select = node('select', 'dropdown'); select.id = `asr-route-${platform}`; caption.htmlFor = select.id;
			fill(select, [['', '跟随默认'], ...options()], settings.routes[platform] ?? '');
			select.addEventListener('change', () => { void save({ routes: routeWith(platform, select.value) }); });
			wrap.append(caption, select); return wrap;
		}));
		if (useContext) { useContext.checked = settings.useContext; const holder = useContext.closest('.checkbox-container'); if (holder) updateToggleState(holder as HTMLElement, useContext); }
		if (autoStart) { autoStart.checked = settings.autoStart; const holder = autoStart.closest('.checkbox-container'); if (holder) updateToggleState(holder as HTMLElement, autoStart); }
	};
	// The local engine to suggest: the one that does best on this computer (Qwen3-ASR on Apple silicon, else the one that runs anywhere).
	const recommendedLocal = () => (localList().find(item => item.id === 'mlx-qwen3') ?? localList().find(item => item.id === 'faster-whisper') ?? LOCAL_ENGINES[0]).id;
	const activate = (item: HTMLElement, action: () => void) => { item.tabIndex = 0; item.setAttribute('role', 'button'); item.addEventListener('click', action); item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } }); return item; };
	const dot = (ready: boolean) => { const item = node('i', 'asr-dot' + (ready ? ' is-ready' : '')); item.setAttribute('role', 'img'); item.setAttribute('aria-label', ready ? '已就绪' : '未就绪'); return item; };
	const cloudFor = (provider: AsrProviderId) => settings.profiles.find(item => item.provider === provider && isConfigured(item));
	const paintRec = () => {
		const localId = recommendedLocal(), meta = LOCAL_ENGINES.find(item => item.id === localId)!, ready = Boolean(localInfo(localId)?.installed), busy = installing?.engine === localId;
		const local = node('div', 'asr-rec-card'), title = node('div', 'asr-rec-title'); title.append(node('span', '', '本机'), node('span', 'asr-badge is-recommend', '推荐'));
		local.dataset.kind = 'local'; local.append(title, node('div', 'asr-rec-sub', '免费，音频不离开这台电脑'));
		const item = node('div', 'asr-rec-item'), info = node('div', 'asr-rec-info'); info.append(node('b', '', meta.name), node('span', '', busy ? `正在安装 ${Math.round(installing!.progress)}%` : ready ? '已安装，随时可用' : `需要先下载，约 ${size(meta.sizeMb)}`));
		item.append(icon(localId), info);
		if (ready) { const ok = node('span', 'asr-ok'); ok.append(dot(true), document.createTextNode('已就绪')); item.append(ok); }
		else item.append(button(busy ? '查看' : '安装', 'btn mod-cta asr-act', () => openLocal(localId)));
		local.append(item);
		const cloud = node('div', 'asr-rec-card'), cloudTitle = node('div', 'asr-rec-title'); cloudTitle.append(node('span', '', '云端'), node('span', 'asr-badge is-recommend', '更快'));
		cloud.dataset.kind = 'cloud'; cloud.append(cloudTitle, node('div', 'asr-rec-sub', '填入 API Key 就能用，音频会上传并按量计费'));
		for (const [id, why] of RECOMMENDED_CLOUD) {
			const saved = cloudFor(id), row = node('div', 'asr-rec-item'), text = node('div', 'asr-rec-info'); text.append(node('b', '', shortName(id)), node('span', '', why)); row.dataset.provider = id;
			row.append(icon(id), text);
			if (saved) { const ok = node('span', 'asr-ok'); ok.append(dot(true), document.createTextNode('已配置')); row.append(ok); } else row.append(button('配置', 'btn asr-act', () => openCloud(newProfile(id), true)));
			cloud.append(row);
		}
		rec.replaceChildren(local, cloud);
	};
	// The viewer's own list: engines that are installed and every saved service. Nothing here that is not theirs.
	const paintList = () => {
		const rows: HTMLElement[] = [];
		const row = (key: string, iconId: string, name: string, badge: string, ready: boolean, sub: string, onOpen: () => void, value?: Recognizer) => {
			const item = activate(node('div', 'asr-row'), onOpen); item.dataset.key = key;
			const text = node('div', 'asr-row-info'), top = node('div', 'asr-row-name'); top.append(node('span', '', name), node('span', 'asr-badge', badge)); if (value && value === defaultRecognizer(settings)) top.append(node('span', 'asr-badge is-default', '默认'));
			text.append(top, node('div', 'asr-row-sub', sub)); item.append(icon(iconId), text, dot(ready), node('span', 'asr-chevron', '›')); return item;
		};
		for (const engine of localList()) if (localInfo(engine.id)?.installed || installing?.engine === engine.id) rows.push(row(`local:${engine.id}`, engine.id, engine.name, '本机', Boolean(localInfo(engine.id)?.installed), installing?.engine === engine.id ? `正在安装 ${Math.round(installing.progress)}%` : '已安装 · 免费 · 音频不上传', () => openLocal(engine.id), `local:${engine.id}`));
		for (const profile of settings.profiles) { const ready = isConfigured(profile); rows.push(row(`cloud:${profile.id}`, profile.provider, profileLabel(profile, settings.profiles), isLocalService(profile.baseUrl) ? '本机服务' : '云端', ready, ready ? profile.model : '还没填完，点击继续配置', () => openCloud(profile, false), `cloud:${profile.id}`)); }
		grid.replaceChildren(...(rows.length ? rows : [node('div', 'asr-empty', '还没有添加。从上面的推荐里选一个就行。')])); addButton.disabled = false;
	};
	const paint = () => { paintDefaults(); paintRec(); paintList(); };
	const paintGrid = () => { paintRec(); paintList(); };
	// One save at a time, in order: two quick changes must not overwrite each other.
	let pending: Promise<unknown> = Promise.resolve();
	const queue = (job: () => Promise<AsrSettings>) => (pending = pending.then(async () => { settings = await job(); paint(); }));
	const save = (patch: Partial<AsrSettings>) => queue(() => saveAsrSettings(patch));
	const refreshEngines = async () => {
		const reply = await asrStatus();
		if (reply.ok) { engines = reply.local; helperProblem = ''; } else helperProblem = reply.error === 'helper-offline' ? '没连上本地助手：安装和使用本机引擎需要先装好本地助手（见 README）。' : reply.error === 'helper-outdated' ? '本地助手版本较旧，请重新运行 python3 native/install.py。' : '';
		say(helperProblem); paint();
	};

	// ---- the dialog ---------------------------------------------------------------------------------------------------
	const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeModal(); };
	const closeModal = () => { modal.style.display = 'none'; document.removeEventListener('keydown', onKey); redraw = undefined; onClose?.(); onClose = undefined; };
	const openModal = (title: string, head: HTMLElement | undefined, body: HTMLElement[], actions: HTMLElement[]) => {
		modalTitle.textContent = title; modalBody.replaceChildren(...(head ? [head] : []), ...body); modalActions.replaceChildren(...actions);
		if (modal.style.display !== 'flex') { modal.style.display = 'flex'; document.addEventListener('keydown', onKey); }
	};
	modal.querySelector('.modal-bg')?.addEventListener('click', closeModal);
	const button = (label: string, className: string, onClick: () => void) => { const item = node('button', className, label); item.type = 'button'; item.addEventListener('click', onClick); return item; };
	const head = (iconId: string, name: string, note?: string) => { const wrap = node('div'), row = node('div', 'asr-modal-head'); row.append(icon(iconId), node('strong', '', name)); wrap.append(row); if (note) wrap.append(node('p', 'asr-modal-note', note)); return wrap; };
	const field = (labelText: string, control: HTMLElement, id: string) => { const wrap = node('div', 'asr-modal-field'), label = node('label', '', labelText); label.htmlFor = id; control.id = id; wrap.append(label, control); return wrap; };
	const input = (value: string, placeholder = '', type = 'text') => { const item = node('input'); item.type = type; item.value = value; item.placeholder = placeholder; item.autocomplete = 'off'; item.spellcheck = false; return item; };

	// A cloud service: every field in one place, a test with what is typed, and a save that closes it.
	const openCloud = (profile: AsrProfile, isNew: boolean) => {
		let draft: AsrProfile = { ...profile };
		const render = () => {
			const info = providerOf(draft.provider), custom = draft.provider === 'custom';
			const providerSelect = node('select', 'dropdown'); fill(providerSelect, PROVIDERS.map(item => [item.id, item.label]), draft.provider);
			const name = input(draft.name ?? '', shortName(draft.provider)), url = input(draft.baseUrl, 'https://api.example.com/v1'), model = input(draft.model); model.setAttribute('list', 'asr-models');
			const models = node('datalist'); models.id = 'asr-models'; info.models.forEach(item => { const option = node('option'); option.value = item; models.append(option); });
			const key = input(draft.apiKey, 'sk-…', 'password');
			const protocol = node('select', 'dropdown'); fill(protocol, [['openai-transcriptions', 'OpenAI 转写接口（/audio/transcriptions）'], ['chat-audio', '音频对话模型（/chat/completions）']], draft.protocol === 'doubao-flash' ? 'openai-transcriptions' : draft.protocol);
			const result = node('div', 'asr-modal-status'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite');
			const read = (): AsrProfile => { const next: AsrProfile = { ...draft, name: name.value.trim() || undefined, baseUrl: url.value.trim(), model: model.value.trim(), apiKey: key.value.trim(), protocol: custom ? protocol.value as AsrProtocol : draft.protocol }; if (!next.name) delete next.name; return next; };
			providerSelect.addEventListener('change', () => { draft = withProvider({ ...read(), provider: draft.provider }, providerSelect.value as AsrProviderId); render(); });
			const noteLine = node('p', 'asr-modal-note', (info.note || '') + ' ');
			if (info.keyHelp) { const link = node('a', '', '获取 API Key'); link.href = info.keyHelp; link.target = '_blank'; link.rel = 'noopener noreferrer'; noteLine.append(link); }
			const test = button('测试连接', 'asr-test', async () => {
				const trial = read();
				if (!isHttpsOrLocal(trial.baseUrl)) { result.textContent = '接口地址需要是 https 地址（本机服务可用 http）'; return; }
				if (!trial.apiKey && !isLocalService(trial.baseUrl)) { result.textContent = '请先填写 API Key'; return; }
				const config = cloudConfig(trial, settings.profiles); if (!config) { result.textContent = '设置还不完整'; return; }
				test.disabled = true; result.textContent = '正在测试…';
				try { const reply = await asrTest({ ...config }, trial.apiKey || 'none'); result.textContent = reply.ok ? `连接正常（${reply.ms ?? '?'} ms）。` : `测试失败：${reply.error || '未知错误'}`; }
				catch { result.textContent = '测试失败：没连上本地助手'; }
				finally { test.disabled = false; }
			});
			const saveButton = button('保存', 'mod-cta', () => { const next = read(); closeModal(); void queue(() => saveProfile(next)); });
			const remove = isNew ? [] : [button('删除', 'asr-danger', () => {
				if (!window.confirm(`删除「${profileLabel(profile, settings.profiles)}」？它保存的 API Key 也会一起删除。`)) return;
				closeModal(); void queue(async () => { const next = await removeProfile(profile.id); return next.profiles.length || next.mode !== 'cloud' ? next : saveAsrSettings({ mode: 'local' }); });
			})];
			openModal(isNew ? `添加 ${shortName(draft.provider)}` : `配置 ${profileLabel(profile, settings.profiles)}`, head(draft.provider, shortName(draft.provider)), [
				noteLine, field('名称（可选，同一服务保存多个模型时用来区分）', name, 'asr-f-name'), field('服务', providerSelect, 'asr-f-provider'),
				...(custom ? [field('请求方式', protocol, 'asr-f-protocol')] : []), field('接口地址', url, 'asr-f-url'), field('模型', model, 'asr-f-model'), models, field('API Key（只保存在这个浏览器里，不随浏览器同步）', key, 'asr-f-key'), result,
			], [...remove, test, button('取消', '', closeModal), saveButton]);
		};
		render();
	};

	// A local engine: what it is, whether it is here, and getting it or removing it. Progress shows on the dialog and on the card.
	const openLocal = (id: string) => {
		const meta = LOCAL_ENGINES.find(item => item.id === id); if (!meta) return;
		const render = () => {
			const here = Boolean(localInfo(id)?.installed), managed = localInfo(id)?.managed !== false, busy = installing?.engine === id;
			const state = node('div', 'asr-modal-status'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
			const meter = node('div', 'asr-meter'), bar = node('i'); meter.append(bar); meter.hidden = !busy; bar.style.width = `${Math.max(2, installing?.progress ?? 0)}%`;
			state.textContent = busy ? `${installing!.stage}（${Math.round(installing!.progress)}%）` : helperProblem || (here ? `已安装${localInfo(id)?.modelReady ? '，模型已就绪' : '，首次使用时会下载模型'}。` : `还没有安装。会下载约 ${size(meta.sizeMb)}（含识别模型）到本机的私有文件夹，不影响系统环境。`);
			const actions: HTMLElement[] = [];
			if (here && managed && !busy) actions.push(button('卸载', 'asr-danger', async () => {
				if (!window.confirm(`卸载「${meta.name}」并删除已下载的识别模型（约 ${size(meta.sizeMb)}）？需要时可以再装回来。`)) return;
				const reply = await asrUninstall(id, true); say(reply.ok ? `已卸载，释放约 ${size(reply.freedMb)}。` : reply.error === 'busy' ? '正在生成字幕或安装，稍后再试。' : '卸载失败'); closeModal(); await refreshEngines(); say(reply.ok ? `已卸载，释放约 ${size(reply.freedMb)}。` : '卸载失败');
			}));
			actions.push(button('关闭', '', closeModal));
			if (here && recognizerFor(settings) !== `local:${id}`) actions.push(button('设为默认', '', () => { closeModal(); void save(choosePatch(settings, `local:${id}`)); }));
			if (!here || busy) actions.push(button(busy ? '取消安装' : '下载并安装', 'mod-cta', () => { if (busy) void asrInstallCancel(installing!.jobId); else void install(id as InstallTarget); }));
			openModal(meta.name, head(id, meta.name, `${meta.note}。本机运行，音频不会离开这台电脑。`), [state, meter], actions);
		};
		redraw = render; render();
	};
	const install = async (target: InstallTarget) => {
		const draw = () => { redraw?.(); paintGrid(); };
		installing = { engine: target, jobId: '', stage: '正在准备安装…', progress: 0 }; draw();
		const started = await asrInstall(target);
		if (!started.ok) { installing = undefined; say('安装失败：' + installProblem(started)); draw(); return; }
		let current: AsrInstall = started, failures = 0;
		while (current.state === 'queued' || current.state === 'installing' || current.state === 'downloadingModel') {
			installing = { engine: target, jobId: started.jobId, stage: current.stage, progress: current.progress }; draw();
			await new Promise(resolve => setTimeout(resolve, 1000));
			const next = await asrInstallPoll(started.jobId);
			if (next.ok) { current = next; failures = 0; } else if (++failures >= 4) { installing = undefined; say('与本地助手的连接中断，安装可能仍在后台进行，稍后刷新页面查看'); draw(); return; }
		}
		installing = undefined; await refreshEngines();
		say(current.state === 'completed' ? '安装完成，可以使用。' : current.state === 'cancelled' ? '已取消安装。' : `安装失败：${current.error || '未知错误'}`); redraw?.();
	};
	// "Add a service": choose which kind, then it opens like any other (and exists only once saved).
	const openPicker = () => {
		const choose = (iconId: string, label: string, note: string, onPick: () => void) => { const item = activate(node('div', 'asr-preset'), onPick); item.dataset.provider = iconId; const text = node('span'); text.append(node('b', '', label)); if (note) { text.append(document.createElement('br'), node('small', '', note)); } item.append(icon(iconId), text); return item; };
		const localOthers = node('div', 'asr-presets'), cloud = node('div', 'asr-presets');
		for (const engine of localList()) if (!localInfo(engine.id)?.installed) localOthers.append(choose(engine.id, engine.name, `约 ${size(engine.sizeMb)}`, () => { closeModal(); openLocal(engine.id); }));
		for (const item of PROVIDERS) cloud.append(choose(item.id, item.label.split(/[\s（(]/)[0], item.id === 'local' ? '你自己在本机运行的服务' : item.id === 'custom' ? '任何兼容 OpenAI 转写接口的服务' : '', () => { closeModal(); openCloud(newProfile(item.id), true); }));
		openModal('添加识别方式', undefined, [node('p', 'asr-modal-note', '还可以保存同一个服务的多个模型，用名称区分。'), ...(localOthers.childElementCount ? [node('div', 'asr-modal-group', '本机引擎（免费，音频不上传）'), localOthers] : []), node('div', 'asr-modal-group', '云端服务（音频会上传并按量计费）'), cloud], [button('取消', '', closeModal)]);
	};

	// ---- wiring -------------------------------------------------------------------------------------------------------
	paint(); void refreshEngines();
	defaultSelect.addEventListener('change', () => { void save(choosePatch(settings, defaultSelect.value)); });
	useContext?.addEventListener('change', () => { void save({ useContext: useContext.checked }); });
	autoStart?.addEventListener('change', () => { void save({ autoStart: autoStart.checked }); });
	addButton.addEventListener('click', openPicker);
}
