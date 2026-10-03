import type { PanelSegment } from './youtube-panel-actions';

// The transcript panel's own data source: YouTube's /next response carries a `getTranscriptEndpoint`, and calling
// get_transcript with its params returns the lines the panel shows. Unlike the caption files it needs no player
// token, and unlike clicking the panel it does not wait for the page to build its UI. Runs in the YouTube tab, so
// the viewer's cookies and origin are used.
const NEXT = '/youtubei/v1/next?prettyPrint=false';
const GET_TRANSCRIPT = '/youtubei/v1/get_transcript?prettyPrint=false';
const FALLBACK_VERSION = '2.20250101.00.00';

export const formatClock = (milliseconds: number): string => {
	const total = Math.max(0, Math.floor(milliseconds / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
	return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
};

// The inline bootstrap scripts hold the client version and visitor data the page itself uses.
export function innertubeContext(doc: Document): Record<string, unknown> {
	const text = Array.from(doc.scripts).map(script => script.textContent || '').filter(value => value.includes('INNERTUBE_CONTEXT_CLIENT_VERSION') || value.includes('visitorData')).join('\n').slice(0, 400000);
	const version = text.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] || FALLBACK_VERSION;
	const visitorData = text.match(/"visitorData":"([^"]+)"/)?.[1];
	const hl = doc.documentElement.lang || 'en';
	return { client: { clientName: 'WEB', clientVersion: version, hl, ...(visitorData ? { visitorData } : {}) } };
}

function find<T>(node: unknown, pick: (value: Record<string, unknown>) => T | undefined, depth = 0): T | undefined {
	if (!node || typeof node !== 'object' || depth > 40) return undefined;
	const found = pick(node as Record<string, unknown>); if (found !== undefined) return found;
	for (const child of Object.values(node as Record<string, unknown>)) { const nested = find(child, pick, depth + 1); if (nested !== undefined) return nested; }
	return undefined;
}

export const findTranscriptParams = (json: unknown): string | undefined =>
	find(json, value => { const endpoint = value.getTranscriptEndpoint as { params?: unknown } | undefined; return typeof endpoint?.params === 'string' ? endpoint.params : undefined; });

const textOf = (value: any): string => typeof value === 'string' ? value : value?.simpleText ?? value?.content ?? (Array.isArray(value?.runs) ? value.runs.map((run: { text?: string }) => run.text || '').join('') : '');

export function parseTranscriptResponse(json: unknown): PanelSegment[] {
	const segments: PanelSegment[] = [];
	const visit = (node: unknown, depth = 0) => {
		if (!node || typeof node !== 'object' || depth > 40) return;
		const value = node as Record<string, any>;
		const renderer = value.transcriptSegmentRenderer ?? value.transcriptSegmentViewModel;
		if (renderer) {
			const start = Number(renderer.startMs), text = textOf(renderer.snippet).replace(/\s+/g, ' ').trim();
			if (Number.isFinite(start) && text) segments.push({ time: formatClock(start), text });
			return;
		}
		for (const child of Object.values(value)) visit(child, depth + 1);
	};
	visit(json);
	return segments;
}

export async function fetchTranscriptSegments(videoId: string, doc: Document, request: typeof fetch = (...args) => fetch(...args)): Promise<PanelSegment[]> {
	const context = innertubeContext(doc);
	const post = async (path: string, body: unknown) => {
		const response = await request(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		if (!response.ok) throw new Error(`YouTube ${response.status}`);
		return response.json();
	};
	const next = await post(NEXT, { context, videoId });
	const params = findTranscriptParams(next);
	if (!params) return [];
	return parseTranscriptResponse(await post(GET_TRANSCRIPT, { context, params }));
}
