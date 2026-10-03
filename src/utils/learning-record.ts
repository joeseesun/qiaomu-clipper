import browser from './browser-polyfill';

export interface LearningSource { title: string; url?: string; timestampSeconds?: number; kind?: 'web' | 'youtube' | 'thought' }
export interface LearningRecordDraft { captureId: string; createdAt: string; source: LearningSource; originSource?: LearningSource; reflection: string; quote: string; aiSupplement?: string }
export interface DailyTargetResult { status: 'ready' | 'unavailable' | 'unsupported' | 'invalid'; vault?: string; date?: string; relativePath?: string; targetToken?: string; error?: string }
export interface LearningSaveResult { status: 'saved' | 'dispatched' | 'unconfirmed' | 'failed' | 'cancelled' | 'target-changed'; captureId: string; vault?: string; date?: string; relativePath?: string; error?: string; duplicate?: boolean; target?: DailyTargetResult }

export function createLearningDraft(source: LearningSource, initial: Partial<Pick<LearningRecordDraft, 'reflection' | 'quote' | 'aiSupplement'>> = {}): LearningRecordDraft {
	return { captureId: crypto.randomUUID(), createdAt: new Date().toISOString(), source: { ...source }, originSource: { ...source }, reflection: initial.reflection || '', quote: initial.quote || '', ...(initial.aiSupplement ? { aiSupplement: initial.aiSupplement } : {}) };
}
const timed = <T>(job: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('保存响应超时')), ms); job.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
const sourceKey = (source: LearningSource) => `qiaomuLearningDraft:${encodeURIComponent(source.url || 'thought')}`;
const recordKey = (source: LearningSource, captureId: string) => `${sourceKey(source)}:record:${captureId}`;
export async function loadLearningDraft(source: LearningSource): Promise<LearningRecordDraft | null> {
    const id = (await browser.storage.local.get(sourceKey(source)))[sourceKey(source)];
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) return null;
    const value = (await browser.storage.local.get(recordKey(source, id)))[recordKey(source, id)] as LearningRecordDraft | undefined;
    return value?.captureId && typeof value.reflection === 'string' && typeof value.quote === 'string' ? value : null;
}
export async function persistLearningDraft(draft: LearningRecordDraft, originSource: LearningSource = draft.originSource || draft.source): Promise<void> {
    draft.originSource = { ...originSource };
    await browser.storage.local.set({ [sourceKey(originSource)]: draft.captureId, [recordKey(originSource, draft.captureId)]: draft });
}
export async function clearLearningDraft(source: LearningSource, captureId: string): Promise<void> {
    // Delete this capture only. Never delete a source index that another tab may have updated.
    await browser.storage.local.remove(recordKey(source, captureId));
}
export async function getDailyTarget(vault?: string): Promise<DailyTargetResult> {
	try { return await timed(browser.runtime.sendMessage({ action: 'qiaomuLearningDailyTarget', vault }), 8000); }
	catch { return { status: 'unavailable', error: '本地保存助手未连接，今日日记位置尚未验证' }; }
}
const uriKey = (captureId: string) => `qiaomuLearningUriAttempt:${captureId}`;
const pendingKey = (captureId: string) => `qiaomuLearningPending:${captureId}`;
const inFlight = new Map<string, Promise<LearningSaveResult>>();
const text = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#!|])/g, '\\$1');
const quoteText = (value: string) => text(value).split(/\r?\n/).map(line => `> ${line}`).join('\n');

export function serializeLearningRecord(draft: LearningRecordDraft): string {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(draft.captureId)) throw new Error('学习记录标识无效');
    if (![draft.reflection, draft.quote, draft.aiSupplement || ''].some(value => typeof value === 'string' && value.trim())) throw new Error('请写下理解或加入摘录，不能保存空记录');
    if (typeof draft.reflection !== 'string' || typeof draft.quote !== 'string' || (draft.aiSupplement !== undefined && typeof draft.aiSupplement !== 'string')) throw new Error('学习记录格式无效');
    const created = new Date(draft.createdAt); if (!Number.isFinite(created.getTime())) throw new Error('记录时间无效');
    const stamp = `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,'0')}-${String(created.getDate()).padStart(2,'0')} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}`;
    const lines = ['### 视频与阅读笔记', '', `- 记录时间：${stamp}`];
    const source = draft.source;
    if (source.timestampSeconds !== undefined && (!Number.isFinite(source.timestampSeconds) || source.timestampSeconds < 0)) throw new Error('视频时间无效');
    if (source.url) {
        const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('来源链接只支持不含凭证的 http(s) 地址');
        if (source.timestampSeconds !== undefined) {
            if (!Number.isFinite(source.timestampSeconds) || source.timestampSeconds < 0) throw new Error('视频时间无效');
            if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) url.searchParams.set('t', String(Math.floor(source.timestampSeconds)));
        }
        const href = url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
        lines.push(`- 来源：[${text((source.title || url.hostname).replace(/\s+/g, ' '))}](${href})`);
    } else if (source.title.trim()) lines.push(`- 来源：${text(source.title.replace(/\s+/g, ' '))}`);
    if (source.timestampSeconds !== undefined && source.timestampSeconds >= 0) lines.push(`- 视频时间：${Math.floor(source.timestampSeconds)} 秒`);
    if (draft.reflection.trim()) lines.push('', '**我的理解**', '', text(draft.reflection.trim()));
    if (draft.quote.trim()) lines.push('', '**原文摘录**', '', quoteText(draft.quote.trim()));
    if (draft.aiSupplement?.trim()) lines.push('', '**AI 补充（用户选择加入）**', '', quoteText(draft.aiSupplement.trim()));
    const content = lines.join('\n');
    if (new TextEncoder().encode(content).length > 4 * 1024 * 1024) throw new Error('记录超过 4 MB，请缩短摘录');
    return content;
}
interface LearningAttempt { captureId: string; content: string; vault: string; expectedTargetToken: string; date: string }
const failed = (draft: LearningRecordDraft, error: unknown): LearningSaveResult => ({ status: 'failed', captureId: draft.captureId, error: error instanceof Error ? error.message : String(error) });

export function saveLearningRecord(draft: LearningRecordDraft, target: DailyTargetResult): Promise<LearningSaveResult> {
    const existing = inFlight.get(draft.captureId); if (existing) return existing;
    const job = (async (): Promise<LearningSaveResult> => {
        const uriAttempt = (await browser.storage.local.get(uriKey(draft.captureId)))[uriKey(draft.captureId)] as LearningSaveResult | undefined;
        if (uriAttempt) return uriAttempt;
        let content: string;
        try { content = serializeLearningRecord(draft); await persistLearningDraft(draft); } catch (error) { return failed(draft, error); }
        let attempt = (await browser.storage.local.get(pendingKey(draft.captureId)))[pendingKey(draft.captureId)] as LearningAttempt | undefined;
        if (attempt && attempt.content !== content) return failed(draft, '此记录可能已写入，内容已变化。请先用原内容核对重试，再新建记录');
        if (!attempt) {
            if (target.status !== 'ready' || !target.vault || !target.targetToken || !target.date) return failed(draft, target.error || '请先确认今日日记目标');
            const current = await getDailyTarget(target.vault);
            if (current.status !== 'ready') return { ...failed(draft, current.error || '无法确认日记目标'), target: current };
            if (current.targetToken !== target.targetToken) return { status: 'target-changed', captureId: draft.captureId, target: current, error: '今日日期或日记设置已变化，请核对新目标后再保存' };
            attempt = { captureId: draft.captureId, content, vault: target.vault, expectedTargetToken: target.targetToken, date: target.date };
            await browser.storage.local.set({ [pendingKey(draft.captureId)]: attempt });
        }
        let result: LearningSaveResult;
        try { result = await timed(browser.runtime.sendMessage({ action: 'qiaomuLearningSave', payload: attempt }), 30000); }
        catch { result = { status: 'unconfirmed', captureId: draft.captureId, error: '保存响应中断，可能已写入；请用同一记录重试，不要重复发送 URI' }; }
        if (result?.status === 'saved' && (!result.vault || !result.relativePath || !result.date)) result = { status: 'unconfirmed', captureId: draft.captureId, error: '助手未提供完整落盘回执，请保留草稿核对' };
        if (!result?.status) result = { status: 'unconfirmed', captureId: draft.captureId, error: '无法确认保存结果，请保留草稿核对' };
        result.captureId = draft.captureId;
        if (result.status === 'saved') {
            await browser.storage.local.remove(pendingKey(draft.captureId));
            const origin = draft.originSource || draft.source;
            const currentDraft = await loadLearningDraft(origin);
            if (currentDraft?.captureId === draft.captureId && serializeLearningRecord(currentDraft) !== attempt.content) {
                await persistLearningDraft({ ...currentDraft, captureId: crypto.randomUUID(), createdAt: new Date().toISOString() }, origin);
                result.error = '提交时的记录已保存；后续编辑已保留为新草稿';
            }
            await clearLearningDraft(origin, draft.captureId);
        } else if (result.status === 'failed' || result.status === 'target-changed' || result.status === 'cancelled') {
            // Native only returns these statuses before writing; uncertain attempts stay frozen.
            await browser.storage.local.remove(pendingKey(draft.captureId));
        }
        return result;
    })().catch(error => ({ status: 'unconfirmed' as const, captureId: draft.captureId, error: error instanceof Error ? error.message : '保存状态中断，请保留草稿核对' })).finally(() => inFlight.delete(draft.captureId));
    inFlight.set(draft.captureId, job); return job;
}

export function dispatchLearningRecord(draft: LearningRecordDraft, vault: string): Promise<LearningSaveResult> {
    if (inFlight.has(draft.captureId)) return Promise.resolve(failed(draft, '此记录正在保存或发送，请等待结果'));
    const job = (async (): Promise<LearningSaveResult> => {
        const previous = (await browser.storage.local.get(uriKey(draft.captureId)))[uriKey(draft.captureId)] as LearningSaveResult | undefined;
        if (previous) return previous;
        try {
            if (!vault.trim()) throw new Error('请明确选择 Obsidian 库，URI 无法验证日记路径');
            const pending = (await browser.storage.local.get(pendingKey(draft.captureId)))[pendingKey(draft.captureId)];
            if (pending) throw new Error('native 写入结果尚未确认，不能重复通过 URI 发送。请用同一记录重试或在 Obsidian 核对');
            const content = serializeLearningRecord(draft); await persistLearningDraft(draft);
            const params = new URLSearchParams({ vault, append: 'true', content });
            const uncertain: LearningSaveResult = { status: 'unconfirmed', captureId: draft.captureId, vault, error: 'URI 发送结果尚未确认，请在 Obsidian 核对，勿重复发送' };
            await browser.storage.local.set({ [uriKey(draft.captureId)]: uncertain });
            let reply: {status?: string; error?: string};
            try { reply = await timed(browser.runtime.sendMessage({ action: 'qiaomuLearningDispatch', url: `obsidian://daily?${params}` }), 8000); }
            catch { return uncertain; }
            if (reply?.status !== 'dispatched') {
                if (reply?.status !== 'failed') return uncertain;
                await browser.storage.local.remove(uriKey(draft.captureId)); return failed(draft, reply?.error || 'URI 未发送，请保留草稿');
            }
            const result: LearningSaveResult = { status: 'dispatched', captureId: draft.captureId, vault, error: '已发送到 Obsidian，实际写入尚未验证。同一记录不会重复发送' };
            await browser.storage.local.set({ [uriKey(draft.captureId)]: result }); return result;
        } catch (error) { return failed(draft, error); }
    })().finally(() => inFlight.delete(draft.captureId));
    inFlight.set(draft.captureId, job); return job;
}
