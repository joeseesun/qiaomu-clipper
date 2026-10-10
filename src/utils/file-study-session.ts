// Only a content hash and display name, scoped to this reader tab/route. Never a File, blob URL, path or API credential.
export interface FileStudySession { key: string; title: string; at: number; pending?: boolean; jobId?: string }
const SLOT = 'qiaomuFileStudySession', KEEP_MS = 24 * 60 * 60_000;
export function readFileStudySession(route: string, now = Date.now()): FileStudySession | undefined {
	try {
		const saved = JSON.parse(sessionStorage.getItem(SLOT) || 'null');
		if (saved?.route === route && /^file:[0-9a-f]{32}$/.test(saved.key) && typeof saved.title === 'string' && saved.title.length <= 512 && Number.isFinite(saved.at) && now >= saved.at && now - saved.at <= KEEP_MS) return { key: saved.key, title: saved.title, at: saved.at, pending: saved.pending === true, ...(typeof saved.jobId === 'string' && /^[0-9a-f]{32}$/.test(saved.jobId) ? { jobId: saved.jobId } : {}) };
	} catch { /* Browser storage can be unavailable. */ }
	return undefined;
}
export function saveFileStudySession(route: string, key: string, title: string, pending = false, jobId?: string): boolean {
	try { sessionStorage.setItem(SLOT, JSON.stringify({ route, key, title: title.slice(0, 512), at: Date.now(), pending, ...(jobId && /^[0-9a-f]{32}$/.test(jobId) ? { jobId } : {}) })); return true; }
	catch { return false; }
}
