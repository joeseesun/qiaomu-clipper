import { generateCodexImage } from './codex-image';
import { generateImage, type ImageModelConfig } from '../write/image-models';
import type { Provider } from '../types/types';
import { inspectLibraryBlob, listImageJobs, readImageJob, saveLibraryImage, writeImageJob, type ImageJob } from './image-library-store';
export interface ImageWork { job: ImageJob; config: ImageModelConfig; provider?: Provider; resume?: boolean }
// Owned by a background document, never by a sidebar or dialog.
export class ImageJobRunner {
	private active = new Map<string, AbortController>();
	private queue: ImageWork[] = [];
	private starting = new Set<string>();
	private initialized?: Promise<void>;
	constructor(private changed: (id: string) => void, private generate = generateImage) {}
	initialize(): Promise<void> {
		return this.initialized ??= (async () => {
			for (const job of await listImageJobs()) if (job.state === 'queued' || job.state === 'running') {
				if (job.engine === 'codex') this.queue.push({ job, resume: true, config: { id: job.configId, sourceId: 'codex-local', engine: 'codex', name: 'Codex', model: job.modelId, models: [job.modelId], baseUrl: '', apiKey: '' } });
				else { await writeImageJob({ ...job, state: 'interrupted' }); this.changed(job.id); }
			}
			this.pump();
		})();
	}
	async enqueue(work: ImageWork): Promise<void> {
		await this.initialize();
		const id = work.job.id;
		if (this.starting.has(id) || this.active.has(id) || this.queue.some(w => w.job.id === id)) return;
		this.starting.add(id);
		try {
			if (await readImageJob(id)) return;
			await writeImageJob(work.job);
			this.queue.push(work); this.changed(id); this.pump();
		} finally { this.starting.delete(id); }
	}
	async cancel(id: string): Promise<void> {
		await this.initialize();
		const controller = this.active.get(id);
		if (controller) { controller.abort(); return; }
		const index = this.queue.findIndex(w => w.job.id === id);
		if (index < 0) return;
		const [{ job }] = this.queue.splice(index, 1);
		await writeImageJob({ ...job, state: 'cancelled' }); this.changed(id);
	}
	private pump(): void {
		while (this.active.size < 2 && this.queue.length) {
			const work = this.queue.shift()!, controller = new AbortController();
			this.active.set(work.job.id, controller);
			void this.run(work, controller);
		}
	}
	private async run({ job, config, provider, resume }: ImageWork, controller: AbortController): Promise<void> {
		try {
			await writeImageJob({ ...job, state: 'running' }); this.changed(job.id);
			controller.signal.throwIfAborted();
			const blob = config.engine === 'codex'
				? await generateCodexImage(job.prompt, job.aspect, config.agentModel || job.modelId, controller.signal, job.id, resume)
				: await this.generate(config, job.prompt, job.aspect, controller.signal, job.modelId, provider);
			controller.signal.throwIfAborted();
			const dimensions = await inspectLibraryBlob(blob);
			controller.signal.throwIfAborted();
			const id = crypto.randomUUID();
			await saveLibraryImage(blob, { id, name: job.prompt.slice(0, 80), created: Date.now(), source: 'generated', prompt: job.prompt, modelLabel: job.modelLabel, ...dimensions }, { ...job, state: 'ready', imageId: id });
		} catch (error) {
			await writeImageJob({ ...job, state: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? undefined : String((error as Error)?.message || error).slice(0, 300) }).catch(() => {});
		} finally {
			this.active.delete(job.id); this.changed(job.id); this.pump();
		}
	}
}
