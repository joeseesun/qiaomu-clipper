import browser from './browser-polyfill';

export interface LearningSource { title: string; url?: string; timestampSeconds?: number; kind?: 'web' | 'youtube' | 'bilibili' | 'thought' }
// A file staged by the local helper. The bytes stay on the machine; the draft only remembers how to show it.
export interface DraftAttachment { id: string; name: string; size: number; kind: 'image' | 'video' | 'audio' | 'pdf' | 'other'; thumb?: string }
export const ATTACHMENT_ID = /^[0-9a-f]{32}$/;
export const MAX_ATTACHMENTS = 20;
// `omit` keeps the text in the draft but leaves it out of the diary entry (the quote, or the source link and video time).
export interface LearningRecordDraft { captureId: string; createdAt: string; source: LearningSource; originSource?: LearningSource; reflection: string; quote: string; aiSupplement?: string; attachments?: DraftAttachment[]; omit?: { quote?: boolean; source?: boolean } }
import type { HelperProblem } from './helper-install';
import { t } from './ui-text';
export interface DailyTargetResult { status: 'ready' | 'unavailable' | 'unsupported' | 'invalid'; vault?: string; date?: string; relativePath?: string; targetToken?: string; error?: string; problem?: HelperProblem }
export interface LearningSaveResult { status: 'saved' | 'dispatched' | 'unconfirmed' | 'failed' | 'cancelled' | 'target-changed'; captureId: string; vault?: string; date?: string; relativePath?: string; error?: string; duplicate?: boolean; target?: DailyTargetResult }

export function createLearningDraft(source: LearningSource, initial: Partial<Pick<LearningRecordDraft, 'reflection' | 'quote' | 'aiSupplement'>> = {}): LearningRecordDraft {
	return { captureId: crypto.randomUUID(), createdAt: new Date().toISOString(), source: { ...source }, originSource: { ...source }, reflection: initial.reflection || '', quote: initial.quote || '', ...(initial.aiSupplement ? { aiSupplement: initial.aiSupplement } : {}) };
}
const timed = <T>(job: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(t('保存响应超时'))), ms); job.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
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
	catch { return { status: 'unavailable', error: t('本地保存助手未连接，今日日记位置尚未验证') }; }
}
const uriKey = (captureId: string) => `qiaomuLearningUriAttempt:${captureId}`;
const pendingKey = (captureId: string) => `qiaomuLearningPending:${captureId}`;
const inFlight = new Map<string, Promise<LearningSaveResult>>();
// Page text and AI answers are untrusted: keep them readable, but neutralise HTML and Obsidian wikilink/embed syntax.
const quoteSafe = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/!?\[\[/g, match => match.replace(/\[/g, '\\['));
const callout = (kind: string, label: string, value: string) => [`> [!${kind}] ${label}`, ...quoteSafe(value.trim()).split(/\r?\n/).map(line => `> ${line}`)].join('\n');
// Page titles can be a whole description; keep the diary line to one readable link.
const LABEL_MAX = 50;
// Some sites (Feishu) pad titles with zero-width characters; drop them so they neither show nor eat the length budget.
const INVISIBLE = /[\p{Cf}\p{Cc}\u2028\u2029]/gu;
const linkLabel = (value: string) => { const flat = Array.from(value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().replace(/[<>]/g, '')), short = flat.length > LABEL_MAX ? flat.slice(0, LABEL_MAX).join('').trimEnd() + '…' : flat.join(''); return short.replace(/([\[\]\\])/g, '\\$1'); };
export const clockLabel = (seconds: number) => { const total = Math.floor(seconds), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0'); };
const TIMED_HOST = /(^|\.)(youtube\.com|youtu\.be|bilibili\.com)$/i;

// One compact, searchable entry for the daily note. The reflection is the user's own Markdown and stays untouched
// (wikilinks and #tags keep working); only content that came from a page or an AI answer is neutralised.
export function serializeLearningRecord(draft: LearningRecordDraft): string {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(draft.captureId)) throw new Error(t('学习记录标识无效'));
    const quoteText = draft.omit?.quote ? '' : draft.quote;
    const attachments = draft.attachments || [];
    if (attachments.length > MAX_ATTACHMENTS || attachments.some(item => !ATTACHMENT_ID.test(item.id)) || new Set(attachments.map(item => item.id)).size !== attachments.length) throw new Error(t('附件列表无效'));
    if (![draft.reflection, quoteText, draft.aiSupplement || ''].some(value => typeof value === 'string' && value.trim()) && !attachments.length) throw new Error(t('请写下理解、加入摘录或附件，不能保存空记录'));
    if (typeof draft.reflection !== 'string' || typeof draft.quote !== 'string' || (draft.aiSupplement !== undefined && typeof draft.aiSupplement !== 'string')) throw new Error(t('学习记录格式无效'));
    const created = new Date(draft.createdAt); if (!Number.isFinite(created.getTime())) throw new Error(t('记录时间无效'));
    const clock = `${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}`;
    const source = draft.source;
    if (source.timestampSeconds !== undefined && (!Number.isFinite(source.timestampSeconds) || source.timestampSeconds < 0)) throw new Error(t('视频时间无效'));
    const head = [clock];
    if (draft.omit?.source) { /* clock only */ }
    else if (source.url) {
        const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(t('来源链接只支持不含凭证的 http(s) 地址'));
        const timed = source.timestampSeconds !== undefined && TIMED_HOST.test(url.hostname);
        if (timed) url.searchParams.set('t', String(Math.floor(source.timestampSeconds!)));
        const href = url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
        head.push(`[${linkLabel(source.title) || linkLabel(url.hostname)}](${href})`);
        if (timed) head.push(`[${clockLabel(source.timestampSeconds!)}](${href})`);
    } else {
        head.push(linkLabel(source.title || '') || t('随手记'));
        if (source.timestampSeconds !== undefined) head.push(clockLabel(source.timestampSeconds));
    }
    const blocks = [`#### ${head.join(' · ')}`];
    if (draft.reflection.trim()) blocks.push(draft.reflection.trim());
    if (quoteText.trim()) blocks.push(callout('quote', t('原文摘录'), quoteText));
    if (draft.aiSupplement?.trim()) blocks.push(callout('info', t('AI 补充（我选择加入）'), draft.aiSupplement));
    // The helper replaces each marker with the wiki link of the copied file once it knows the final file name.
    for (const item of attachments) blocks.push(attachmentMarker(item.id));
    const content = blocks.join('\n\n');
    if (new TextEncoder().encode(content).length > 4 * 1024 * 1024) throw new Error(t('记录超过 4 MB，请缩短摘录'));
    return content;
}
export const attachmentMarker = (id: string) => `\u27e6att:${id}\u27e7`;
interface LearningAttempt { captureId: string; content: string; vault: string; expectedTargetToken: string; date: string; attachments?: string[] }
const failed = (draft: LearningRecordDraft, error: unknown): LearningSaveResult => ({ status: 'failed', captureId: draft.captureId, error: error instanceof Error ? error.message : String(error) });

export function saveLearningRecord(draft: LearningRecordDraft, target: DailyTargetResult): Promise<LearningSaveResult> {
    const existing = inFlight.get(draft.captureId); if (existing) return existing;
    const job = (async (): Promise<LearningSaveResult> => {
        const uriAttempt = (await browser.storage.local.get(uriKey(draft.captureId)))[uriKey(draft.captureId)] as LearningSaveResult | undefined;
        if (uriAttempt) return uriAttempt;
        let content: string;
        try { content = serializeLearningRecord(draft); await persistLearningDraft(draft); } catch (error) { return failed(draft, error); }
        let attempt = (await browser.storage.local.get(pendingKey(draft.captureId)))[pendingKey(draft.captureId)] as LearningAttempt | undefined;
        if (attempt && attempt.content !== content) return failed(draft, t('此记录可能已写入，内容已变化。请先用原内容核对重试，再新建记录'));
        if (!attempt) {
            if (target.status !== 'ready' || !target.vault || !target.targetToken || !target.date) return failed(draft, target.error || t('请先确认今日日记目标'));
            const current = await getDailyTarget(target.vault);
            if (current.status !== 'ready') return { ...failed(draft, current.error || t('无法确认日记目标')), target: current };
            if (current.targetToken !== target.targetToken) return { status: 'target-changed', captureId: draft.captureId, target: current, error: t('今日日期或日记设置已变化，请核对新目标后再保存') };
            attempt = { captureId: draft.captureId, content, vault: target.vault, expectedTargetToken: target.targetToken, date: target.date, ...(draft.attachments?.length ? { attachments: draft.attachments.map(item => item.id) } : {}) };
            await browser.storage.local.set({ [pendingKey(draft.captureId)]: attempt });
        }
        let result: LearningSaveResult;
        try { result = await timed(browser.runtime.sendMessage({ action: 'qiaomuLearningSave', payload: attempt }), 30000); }
        catch { result = { status: 'unconfirmed', captureId: draft.captureId, error: t('保存响应中断，可能已写入；请用同一记录重试，不要重复发送 URI') }; }
        if (result?.status === 'saved' && (!result.vault || !result.relativePath || !result.date)) result = { status: 'unconfirmed', captureId: draft.captureId, error: t('助手未提供完整落盘回执，请保留草稿核对') };
        if (!result?.status) result = { status: 'unconfirmed', captureId: draft.captureId, error: t('无法确认保存结果，请保留草稿核对') };
        result.captureId = draft.captureId;
        if (result.status === 'saved') {
            await browser.storage.local.remove(pendingKey(draft.captureId));
            const origin = draft.originSource || draft.source;
            const currentDraft = await loadLearningDraft(origin);
            if (currentDraft?.captureId === draft.captureId && serializeLearningRecord(currentDraft) !== attempt.content) {
                // Files that went into the saved entry were moved into the vault; only newer ones stay with the new draft.
                const rest = (currentDraft.attachments || []).filter(item => !attempt!.content.includes(item.id));
                await persistLearningDraft({ ...currentDraft, attachments: rest, captureId: crypto.randomUUID(), createdAt: new Date().toISOString() }, origin);
                result.error = t('提交时的记录已保存；后续编辑已保留为新草稿');
            }
            await clearLearningDraft(origin, draft.captureId);
        } else if (result.status === 'failed' || result.status === 'target-changed' || result.status === 'cancelled') {
            // Native only returns these statuses before writing; uncertain attempts stay frozen.
            await browser.storage.local.remove(pendingKey(draft.captureId));
        }
        return result;
    })().catch(error => ({ status: 'unconfirmed' as const, captureId: draft.captureId, error: error instanceof Error ? error.message : t('保存状态中断，请保留草稿核对') })).finally(() => inFlight.delete(draft.captureId));
    inFlight.set(draft.captureId, job); return job;
}

export function dispatchLearningRecord(draft: LearningRecordDraft, vault: string): Promise<LearningSaveResult> {
    if (inFlight.has(draft.captureId)) return Promise.resolve(failed(draft, t('此记录正在保存或发送，请等待结果')));
    const job = (async (): Promise<LearningSaveResult> => {
        const previous = (await browser.storage.local.get(uriKey(draft.captureId)))[uriKey(draft.captureId)] as LearningSaveResult | undefined;
        if (previous) return previous;
        try {
            if (!vault.trim()) throw new Error(t('请明确选择 Obsidian 库，URI 无法验证日记路径'));
            if (draft.attachments?.length) throw new Error(t('附件需要本地助手才能复制进库，URI 发送不支持附件'));
            const pending = (await browser.storage.local.get(pendingKey(draft.captureId)))[pendingKey(draft.captureId)];
            if (pending) throw new Error(t('native 写入结果尚未确认，不能重复通过 URI 发送。请用同一记录重试或在 Obsidian 核对'));
            const content = serializeLearningRecord(draft); await persistLearningDraft(draft);
            const params = new URLSearchParams({ vault, append: 'true', content });
            const uncertain: LearningSaveResult = { status: 'unconfirmed', captureId: draft.captureId, vault, error: t('URI 发送结果尚未确认，请在 Obsidian 核对，勿重复发送') };
            await browser.storage.local.set({ [uriKey(draft.captureId)]: uncertain });
            let reply: {status?: string; error?: string};
            try { reply = await timed(browser.runtime.sendMessage({ action: 'qiaomuLearningDispatch', url: `obsidian://daily?${params}` }), 8000); }
            catch { return uncertain; }
            if (reply?.status !== 'dispatched') {
                if (reply?.status !== 'failed') return uncertain;
                await browser.storage.local.remove(uriKey(draft.captureId)); return failed(draft, reply?.error || t('URI 未发送，请保留草稿'));
            }
            const result: LearningSaveResult = { status: 'dispatched', captureId: draft.captureId, vault, error: t('已发送到 Obsidian，实际写入尚未验证。同一记录不会重复发送') };
            await browser.storage.local.set({ [uriKey(draft.captureId)]: result }); return result;
        } catch (error) { return failed(draft, error); }
    })().finally(() => inFlight.delete(draft.captureId));
    inFlight.set(draft.captureId, job); return job;
}

// ---- Attachments: staged by the local helper, never held in the page ----
export interface AttachResult { items: DraftAttachment[]; errors: string[]; cancelled?: boolean }
// Above this a file is not read into the page at all: the helper copies it from where it already is.
export const ATTACH_BYTES_LIMIT = 4 * 1024 * 1024;
type NativeAttach = { ok?: boolean; cancelled?: boolean; error?: string; items?: Array<DraftAttachment & { origName?: string; origSize?: number }>; errors?: string[] };
const attachNative = async (payload: Record<string, unknown>): Promise<NativeAttach> => {
	try { return await timed(browser.runtime.sendMessage({ action: 'qiaomuLearningAttach', payload }), 10 * 60 * 1000) as NativeAttach; }
	catch { return { ok: false, error: t('本地助手未连接，无法添加附件') }; }
};
const strip = ({ origName: _name, origSize: _size, ...item }: DraftAttachment & { origName?: string; origSize?: number }): DraftAttachment => item;
const toBase64 = async (file: File): Promise<string> => {
	const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
};
const pad = (value: number) => String(value).padStart(2, '0');
// Browsers call every pasted screenshot "image.png"; give it a name that tells the files apart once it is in the vault.
export function attachmentName(file: File, index: number, now = new Date()): string {
	if (!/^image\.\w+$/i.test(file.name) && file.name) return file.name;
	const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'png';
	return `Pasted image ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${index ? '-' + (index + 1) : ''}.${ext}`;
}
export async function pickAttachments(): Promise<AttachResult> {
	const reply = await attachNative({ mode: 'pick' });
	if (reply.cancelled) return { items: [], errors: [], cancelled: true };
	if (!reply.ok) return { items: [], errors: [reply.error || t('无法添加附件')] };
	return { items: (reply.items || []).map(strip), errors: reply.errors || [] };
}
// Pasted or dropped files. Small ones travel as bytes. A large one is found again by the helper where it lives (the
// clipboard for a paste, the Finder selection for a drop), because a page is never told a file's path.
export async function addAttachments(files: File[], source: 'clipboard' | 'finder'): Promise<AttachResult> {
	const items: DraftAttachment[] = [], errors: string[] = [];
	const large = files.filter(file => file.size > ATTACH_BYTES_LIMIT);
	let local: NativeAttach = {};
	if (large.length) local = await attachNative({ mode: 'local', source, names: large.map(file => ({ name: file.name, size: file.size })) });
	for (const [index, file] of files.entries()) {
		if (file.size > ATTACH_BYTES_LIMIT) {
			const found = local.items?.find(item => item.origName === file.name && item.origSize === file.size);
			if (found) items.push(strip(found));
			else errors.push(t('{0} 较大，请用“添加附件”选择，或在访达里复制后粘贴', [file.name]));
			continue;
		}
		const reply = await attachNative({ mode: 'bytes', name: attachmentName(file, index), data: await toBase64(file) });
		if (reply.ok && reply.items?.[0]) items.push(strip(reply.items[0])); else errors.push(reply.error || t('{0} 添加失败', [file.name]));
	}
	if (local.errors?.length) errors.push(...local.errors);
	return { items, errors };
}
export function discardAttachments(ids: string[]): void {
	if (ids.length) void attachNative({ mode: 'discard', ids }).catch(() => { /* old staged files are pruned by the helper */ });
}
