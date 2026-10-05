import browser from './browser-polyfill';
import { Template } from '../types/types';
export interface LocalSavePayload { requestId: string; content: string; name: string; folder: string; vault: string; behavior: Template['behavior'] }
export interface LocalSaveResult { ok: boolean; reason?: string; error?: string; cancelled?: boolean; vault?: string; vaultPath?: string; path?: string; relativePath?: string; folder?: string }
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
