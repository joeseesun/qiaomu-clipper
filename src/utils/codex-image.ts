import browser from './browser-polyfill';
async function native(action: string, args: Record<string, unknown> = {}): Promise<any> {
	const result: any = await browser.runtime.sendMessage({ action, ...args });
	if (!result?.ok) throw new Error(result?.error || 'codex-helper-unavailable');
	return result;
}
export const codexImageStatus = (): Promise<{ signedIn: boolean; models: { id: string; name?: string }[] }> => native('codexImageStatus');
export async function generateCodexImage(prompt: string, aspect: string, model: string, signal?: AbortSignal, jobId?: string, resume = false): Promise<Blob> {
	signal?.throwIfAborted();
	const id = jobId || crypto.randomUUID();
	const cancel = () => { void native('codexImageCancel', { id }).catch(() => {}); };
	signal?.addEventListener('abort', cancel, { once: true });
	try {
		if (!resume) await native('codexImageStart', { id, prompt: `${prompt}\nImage aspect ratio: ${aspect}.`, model: model === 'default' || model === 'imagegen' ? '' : model });
		if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
		const deadline = Date.now() + 12 * 60_000;
		while (true) {
			signal?.throwIfAborted();
			const job = await native('codexImagePoll', { id });
			if (job.state === 'ready') {
				const chunks: Uint8Array[] = []; let offset = 0;
				while (offset < job.size) {
					signal?.throwIfAborted();
					const part = await native('codexImageRead', { id, offset });
					const bytes = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
					if (!bytes.length || part.next !== offset + bytes.length || part.next > job.size) throw new Error('empty-image');
					chunks.push(bytes); offset = part.next;
				}
				return new Blob(chunks as BlobPart[], { type: job.type });
			}
			if (['failed', 'cancelled', 'interrupted'].includes(job.state)) throw new Error(job.error || 'empty-image');
			if (Date.now() > deadline) { cancel(); throw new Error('codex-image-timeout'); }
			await new Promise<void>(resolve => setTimeout(resolve, 1200));
		}
	} finally { signal?.removeEventListener('abort', cancel); }
}
