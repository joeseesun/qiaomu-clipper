import browser from './browser-polyfill';
import { Template } from '../types/types';
export interface LocalSavePayload { requestId: string; content: string; name: string; folder: string; vault: string; behavior: Template['behavior'] }
export interface LocalSaveResult { ok: boolean; error?: string; cancelled?: boolean; vault?: string; vaultPath?: string; path?: string; relativePath?: string; folder?: string }
export async function saveLocalClip(payload: LocalSavePayload): Promise<LocalSaveResult> {
	try { return await browser.runtime.sendMessage({ action: 'qiaomuLocalSave', payload }); }
	catch { return { ok: false, error: '本地保存中断，请重试' }; }
}
