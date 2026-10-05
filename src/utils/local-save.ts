import browser from './browser-polyfill';
import { Template } from '../types/types';
import { activeProfile, choosePatch, cloudConfig, effectiveFor, isConfigured, isHttpsOrLocal, isLocalService, loadAsrSettings, platformOf, profileLabel, saveAsrSettings, LOCAL_ENGINE_IDS, type AsrSettings } from './asr-settings';
export interface LocalSavePayload { requestId: string; content: string; name: string; folder: string; vault: string; behavior: Template['behavior'] }
export interface LocalSaveResult { ok: boolean; error?: string; cancelled?: boolean; vault?: string; vaultPath?: string; path?: string; relativePath?: string; folder?: string }
export async function saveLocalClip(payload: LocalSavePayload): Promise<LocalSaveResult> {
	try { return await browser.runtime.sendMessage({ action: 'qiaomuLocalSave', payload }); }
	catch { return { ok: false, error: '本地保存中断，请重试' }; }
}

// Private diary records have a separate native-only route and never enter RSS submission.
const learningInFlight = new Map<string, Promise<unknown>>();
const invokeLearningNative = (payload: unknown) => Promise.resolve().then(() => browser.runtime.sendNativeMessage('ai.qiaomu.clipper', payload));
export function handleLearningNativeMessage(request: unknown, sender: { id?: string; url?: string }): Promise<unknown> | undefined {
    const message = request as { action?: string; vault?: string; url?: string; payload?: { captureId?: string; vault?: string } };
    if (!['qiaomuLearningDailyTarget', 'qiaomuLearningSave', 'qiaomuLearningDispatch', 'qiaomuLearningAttach'].includes(message?.action || '')) return;
    // Extension pages and this extension's own content scripts (the quick-note card on ordinary pages) both carry our id.
    // Web pages and other extensions cannot reach this listener with it.
    if (sender.id !== browser.runtime.id) return Promise.resolve({ status: 'failed', error: '日记请求被拒绝，请刷新页面后重试' });
    if (message.action === 'qiaomuLearningDispatch') {
        try {
            const uri = new URL(message.url || '');
            if (uri.protocol !== 'obsidian:' || uri.hostname !== 'daily' || uri.searchParams.get('append') !== 'true' || !uri.searchParams.get('vault') || !uri.searchParams.get('content') || Array.from(uri.searchParams.keys()).some(key => !['vault','append','content'].includes(key))) throw new Error('无效的日记 URI');
            // A new background tab leaves the existing learning/video document untouched.
            return Promise.resolve().then(() => browser.tabs.create({ url: uri.href, active: false }))
                .then(() => ({ status: 'dispatched' }))
                .catch(() => ({ status: 'failed', error: '无法发送到 Obsidian，请保留草稿' }));
        } catch { return Promise.resolve({ status: 'failed', error: '无效的日记 URI' }); }
    }
    if (message.action === 'qiaomuLearningAttach') {
        const attach = (message as { payload?: { mode?: string; name?: string; data?: string; source?: string; names?: unknown; ids?: unknown } }).payload || {};
        const action = ({ pick: 'attachPick', local: 'attachLocal', bytes: 'attachBytes', discard: 'attachDiscard' } as Record<string, string>)[attach.mode || ''];
        if (!action) return Promise.resolve({ ok: false, error: '不支持的附件操作' });
        const names = Array.isArray(attach.names) ? attach.names.slice(0, 20).map(item => ({ name: String((item as { name?: unknown }).name ?? ''), size: Number((item as { size?: unknown }).size) })) : undefined;
        const ids = Array.isArray(attach.ids) ? attach.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)) : undefined;
        return invokeLearningNative({ action, name: attach.name, data: attach.data, source: attach.source === 'clipboard' ? 'clipboard' : 'finder', names, ids })
            .then(result => (result as { ok?: boolean }).ok !== undefined ? result : { ok: false, error: '请更新本地助手以支持附件' })
            .catch(() => ({ ok: false, error: '本地助手未连接，无法添加附件' }));
    }
    if (message.action === 'qiaomuLearningDailyTarget') return invokeLearningNative({ action: 'learningDailyTarget', vault: message.vault })
        .then(result => (result as {status?: string}).status ? result : { status: 'unavailable', error: '请安装或更新本地助手以确认日记目标' })
        .catch(() => ({ status: 'unavailable', error: '本地助手未连接，无法验证今日日记位置' }));
    const payload = message.payload;
    if (!payload || !/^[a-zA-Z0-9-]{8,80}$/.test(payload.captureId || '')) return Promise.resolve({ status: 'failed', error: '学习记录标识无效' });
    const id = payload.captureId!;
    if (learningInFlight.has(id)) return learningInFlight.get(id);
    const job = invokeLearningNative({ ...payload, action: 'saveLearning' })
        .then(result => (result as {status?: string}).status ? result : { status: 'unconfirmed', captureId: id, error: '无法确认助手保存结果，请保留草稿核对' })
        .catch(() => ({ status: 'unconfirmed', captureId: id, error: '保存响应中断，可能已经写入。请用同一记录重试，勿重复发送 URI' }))
        .finally(() => learningInFlight.delete(id));
    learningInFlight.set(id, job);
    return job;
}

// Subtitle generation talks to the same local helper, with a fixed set of requests and checked arguments. When the viewer chose a
// cloud recognition service, the background adds its settings here: a page script only ever asks, and never holds the key.
const ASR_ACTIONS: Record<string, string> = { status: 'asrStatus', choose: 'asrStatus', start: 'asrStart', poll: 'asrPoll', cancel: 'asrCancel', test: 'asrCloudTest', probe: 'asrProbe', uploadStart: 'asrUploadStart', uploadChunk: 'asrUploadChunk', uploadFinish: 'asrUploadFinish', install: 'asrInstall', installPoll: 'asrInstallPoll', installCancel: 'asrInstallCancel', uninstall: 'asrUninstall' };
const ASR_ENGINE = /^(mlx|mlx-qwen3|faster-whisper)$/;
const ASR_KEY = /^(youtube:[A-Za-z0-9_-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4}|xiaoyuzhou:[0-9a-f]{24}|file:[0-9a-f]{32}|rss:[0-9a-f]{12}:[0-9a-f]{16}|web:[0-9a-f]{12})$/;
const ASR_LANGUAGE = /^(auto|zh|en|ja|ko|de|fr|es|ru|pt|it)$/;
const ASR_COOKIES = /^(chrome|edge|brave|chromium|firefox|safari)$/;
type AsrPayload = { mode?: string; videoKey?: string; language?: string; force?: boolean; cookies?: string; jobId?: string; since?: number; cloud?: Record<string, unknown>; apiKey?: string; engine?: string; profile?: string; model?: boolean; auto?: boolean; name?: string; rss?: { feed?: unknown; guid?: unknown }; web?: { url?: unknown }; url?: string; size?: number; uploadId?: string; index?: number; data?: string };
const validCloud = (cloud: Record<string, unknown> | undefined): cloud is Record<string, unknown> => Boolean(cloud && ['openai-transcriptions', 'chat-audio', 'doubao-flash'].includes(String(cloud.protocol)) && typeof cloud.baseUrl === 'string' && isHttpsOrLocal(cloud.baseUrl) && /^[A-Za-z0-9_./:\-]{1,100}$/.test(String(cloud.model || '')) && ['none', 'segments'].includes(String(cloud.timestamps || 'none')) && (cloud.contextMode === undefined || ['doubao', 'prompt'].includes(String(cloud.contextMode))) && ['chunkSeconds', 'maxChunkSeconds'].every(name => cloud[name] === undefined || (typeof cloud[name] === 'number' && cloud[name] >= 5 && cloud[name] <= 900)));
export function handleAsrMessage(request: unknown, sender: { id?: string; url?: string }): Promise<unknown> | undefined {
    const message = request as { action?: string; payload?: AsrPayload };
    if (message?.action !== 'qiaomuAsr') return;
    if (sender.id !== browser.runtime.id) return Promise.resolve({ ok: false, error: 'refused' });
    const payload = message.payload || {}, action = ASR_ACTIONS[payload.mode || ''];
    if (!action) return Promise.resolve({ ok: false, error: 'bad-request' });
    const body: Record<string, unknown> = { action };
    if (payload.mode === 'start') {
        if (!ASR_KEY.test(payload.videoKey || '') || !ASR_LANGUAGE.test(payload.language || 'auto') || (payload.cookies !== undefined && !ASR_COOKIES.test(payload.cookies))) return Promise.resolve({ ok: false, error: 'bad-request' });
        // A podcast from a feed carries the feed's address: only the extension's own pages may name one, and it must be an https address.
        if (payload.videoKey!.startsWith('rss:')) {
            const ref = payload.rss;
            if (!sender.url?.startsWith(browser.runtime.getURL('')) || !ref || typeof ref.feed !== 'string' || typeof ref.guid !== 'string' || ref.feed.length > 600 || ref.guid.length > 800 || !/^https:\/\//.test(ref.feed)) return Promise.resolve({ ok: false, error: 'bad-request' });
            body.rss = { feed: ref.feed, guid: ref.guid };
        }
        // Any other site: its address comes with the request, from the extension's own pages only, and must be https.
        if (payload.videoKey!.startsWith('web:')) {
            const ref = payload.web;
            if (!sender.url?.startsWith(browser.runtime.getURL('')) || !ref || typeof ref.url !== 'string' || ref.url.length > 1500 || !/^https:\/\//.test(ref.url)) return Promise.resolve({ ok: false, error: 'bad-request' });
            body.web = { url: ref.url };
        }
        Object.assign(body, { videoKey: payload.videoKey, language: payload.language || 'auto', force: payload.force === true, ...(payload.cookies ? { cookies: payload.cookies } : {}) });
    } else if (payload.mode === 'poll' || payload.mode === 'cancel') {
        if (!/^[0-9a-f]{32}$/.test(payload.jobId || '')) return Promise.resolve({ ok: false, error: 'bad-request' });
        Object.assign(body, { jobId: payload.jobId, ...(payload.mode === 'poll' ? { since: Number.isInteger(payload.since) && payload.since! >= 0 ? payload.since : 0 } : {}) });
    } else if (payload.mode === 'install' || payload.mode === 'uninstall') {
        if (!(payload.mode === 'install' && payload.engine === 'base') && !ASR_ENGINE.test(payload.engine || '')) return Promise.resolve({ ok: false, error: 'bad-request' });
        // Taking an engine away is a settings-page action; a video page can only ask to add one.
        if (payload.mode === 'uninstall' && !sender.url?.startsWith(browser.runtime.getURL(''))) return Promise.resolve({ ok: false, error: 'refused' });
        Object.assign(body, { engine: payload.engine, ...(payload.mode === 'uninstall' ? { model: payload.model === true } : {}) });
    } else if (payload.mode === 'probe') {
        if (!sender.url?.startsWith(browser.runtime.getURL('')) || typeof payload.url !== 'string' || payload.url.length > 1500 || !/^https:\/\//.test(payload.url)) return Promise.resolve({ ok: false, error: sender.url?.startsWith(browser.runtime.getURL('')) ? 'bad-request' : 'refused' });
        body.url = payload.url;
    } else if (payload.mode === 'uploadStart' || payload.mode === 'uploadChunk' || payload.mode === 'uploadFinish') {
        // Only the extension's own pages hand a file over; a web page cannot send the helper files.
        if (!sender.url?.startsWith(browser.runtime.getURL(''))) return Promise.resolve({ ok: false, error: 'refused' });
        const id = /^[0-9a-f]{32}$/.test(payload.uploadId || '');
        if (payload.mode === 'uploadStart') { if (typeof payload.name !== 'string' || payload.name.length > 300 || !Number.isInteger(payload.size)) return Promise.resolve({ ok: false, error: 'bad-request' }); Object.assign(body, { name: payload.name, size: payload.size }); }
        else if (!id) return Promise.resolve({ ok: false, error: 'bad-request' });
        else if (payload.mode === 'uploadChunk') { if (!Number.isInteger(payload.index) || typeof payload.data !== 'string' || payload.data.length > 6 * 1024 * 1024) return Promise.resolve({ ok: false, error: 'bad-request' }); Object.assign(body, { uploadId: payload.uploadId, index: payload.index, data: payload.data }); }
        else Object.assign(body, { uploadId: payload.uploadId });
    } else if (payload.mode === 'installPoll' || payload.mode === 'installCancel') {
        if (!/^[0-9a-f]{32}$/.test(payload.jobId || '')) return Promise.resolve({ ok: false, error: 'bad-request' });
        body.jobId = payload.jobId;
    } else if (payload.mode === 'choose') {
        if (payload.profile === undefined && !(LOCAL_ENGINE_IDS as string[]).includes(payload.engine || '')) return Promise.resolve({ ok: false, error: 'bad-request' });
        if (payload.profile !== undefined && !/^[A-Za-z0-9_-]{1,24}$/.test(payload.profile)) return Promise.resolve({ ok: false, error: 'bad-request' });
        body.action = 'asrStatus';
    } else if (payload.mode === 'test') {
        // Only the extension's own settings page may try a key (it passes the form's values, which may not be saved yet).
        if (!sender.url?.startsWith(browser.runtime.getURL('')) || !validCloud(payload.cloud) || typeof payload.apiKey !== 'string' || (!payload.apiKey.trim() && !isLocalService(String(payload.cloud.baseUrl)))) return Promise.resolve({ ok: false, error: 'bad-request' });
        Object.assign(body, { cloud: payload.cloud, cloudKey: payload.apiKey.trim() || 'none' });
    }
    const needsSettings = payload.mode === 'status' || payload.mode === 'start' || payload.mode === 'choose';
    // Each site can have its own way of recognising: what applies is the one for the video's platform, else the default.
    if (needsSettings && payload.videoKey !== undefined && !ASR_KEY.test(payload.videoKey)) return Promise.resolve({ ok: false, error: 'bad-request' });
    const platform = platformOf(payload.videoKey);
    return (needsSettings ? loadAsrSettings() : Promise.resolve(undefined)).then(async stored => {
        let chosen = stored ? effectiveFor(stored, platform) : undefined;
        // What the page says about a video is used as background for recognition unless the viewer turned that off.
        if (payload.mode === 'start' && stored?.useContext === false) body.context = false;
        if (payload.mode === 'choose') {
            if (!stored) return { ok: false, error: 'bad-request' };
            const value = payload.profile !== undefined ? (stored.profiles.some(item => item.id === payload.profile) ? 'cloud:' + payload.profile : undefined)
                : (LOCAL_ENGINE_IDS as string[]).includes(payload.engine || '') ? 'local:' + payload.engine : undefined;
            if (!value) return { ok: false, error: 'bad-request' };
            const patch: Partial<AsrSettings> = choosePatch(stored, value, platform);
            if (typeof payload.auto === 'boolean') patch.autoStart = payload.auto;
            chosen = effectiveFor(await saveAsrSettings(patch), platform); body.action = 'asrStatus'; payload.mode = 'status';
        }
        let label: string | undefined, here = false;
        if (chosen?.mode === 'cloud') {
            const profile = activeProfile(chosen), cloud = profile && cloudConfig(profile, chosen.profiles);
            if (!profile || !cloud) return { ok: false, error: 'cloud-not-configured' };
            label = cloud.label; here = isLocalService(profile.baseUrl);
            if (payload.mode === 'status') body.cloud = true; else Object.assign(body, { cloud, cloudKey: profile.apiKey || 'none' });
        } else if (chosen && chosen.engine !== 'auto') body.engine = chosen.engine;
        const result = await invokeLearningNative(body)
            // A helper from before this feature answers every unknown request with an "unsupported" error.
            .then(answer => { const reply = answer as { ok?: boolean; error?: string }; return reply && typeof reply.ok === 'boolean' ? (reply.ok === false && /不支持|unsupported/i.test(reply.error || '') ? { ok: false, error: 'helper-outdated' } : answer) : { ok: false, error: 'helper-outdated' }; })
            .catch(() => ({ ok: false, error: 'helper-offline' }));
        return payload.mode === 'status' && (result as { ok?: boolean }).ok ? { ...(result as object), mode: chosen?.mode ?? 'local', ...(label ? { cloudLabel: label, cloudLocal: here } : {}), choices: summary(chosen!) } : result;
    });
}
// The viewer's choices without any key: what a page may show in its picker.
const summary = (settings: AsrSettings) => ({ mode: settings.mode, engine: settings.engine, auto: settings.autoStart, active: activeProfile(settings)?.id ?? '', profiles: settings.profiles.map(item => ({ id: item.id, label: profileLabel(item, settings.profiles), local: isLocalService(item.baseUrl), configured: isConfigured(item) })) });
