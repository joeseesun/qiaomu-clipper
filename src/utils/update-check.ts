// The local edition is not updated by the Web Store: say whether a newer release is out, from the project's own releases page.
export const RELEASES_URL = 'https://github.com/joeseesun/qiaomu-clipper/releases';
const LATEST_API = 'https://api.github.com/repos/joeseesun/qiaomu-clipper/releases/latest';

// "1.14.4" vs "1.15.0": numbers part by part; a leading v is ignored; anything that is not a version compares as unknown (0).
export function compareVersions(a: string, b: string): number {
	const parts = (v: string) => v.trim().replace(/^v/i, '').split(/[.\-+]/).map(x => (/^\d+$/.test(x) ? Number(x) : 0));
	const x = parts(a), y = parts(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
	return 0;
}

export type UpdateStatus = { state: 'current'; version: string } | { state: 'newer'; version: string; url: string } | { state: 'unknown' };

// Only an answer that was actually read counts: a failed check says "unknown", never "you are up to date".
export async function checkForUpdate(current: string, fetcher: typeof fetch = fetch): Promise<UpdateStatus> {
	try {
		const response = await fetcher(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit' });
		if (!response.ok) return { state: 'unknown' };
		const release = await response.json() as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
		const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
		if (!/^v?\d+(\.\d+)*$/.test(tag) || release.draft || release.prerelease) return { state: 'unknown' };
		const url = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES_URL) ? release.html_url : RELEASES_URL;
		return compareVersions(tag, current) > 0 ? { state: 'newer', version: tag.replace(/^v/i, ''), url } : { state: 'current', version: current };
	} catch { return { state: 'unknown' }; }
}

export interface ReleaseNotes { version: string; date: string; lines: { kind: 'heading' | 'item' | 'text'; text: string }[] }

// A release can carry the notes twice, under "## 中文" and "## English" headings: the reader gets the part in their own language.
export function releaseBodyFor(body: string, english: boolean): string {
	const lines = body.split(/\r?\n/);
	const marker = (line: string) => /^#{1,3}\s*English\s*$/i.test(line.trim()) ? 'en' : /^#{1,3}\s*(中文|简体中文|Chinese)\s*$/i.test(line.trim()) ? 'zh' : '';
	const starts = lines.map((line, index) => [marker(line), index] as const).filter(([kind]) => kind);
	if (!starts.some(([kind]) => kind === 'en') || !starts.some(([kind]) => kind === 'zh')) return body;
	const want = english ? 'en' : 'zh';
	return starts.map(([kind, index], at) => kind === want ? lines.slice(index + 1, at + 1 < starts.length ? starts[at + 1][1] : undefined).join('\n') : '').join('\n');
}

// A release body is Markdown. The page shows plain text only: headings, bullet items and short paragraphs, links and emphasis stripped.
export function releaseNoteLines(body: string, max = 14): ReleaseNotes['lines'] {
	const lines: ReleaseNotes['lines'] = [];
	for (const raw of body.replace(/<[^>]*>/g, '').split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^\*\*full changelog\*\*/i.test(line)) continue;
		const clean = (value: string) => value.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/https?:\/\/\S+/g, '').trim();
		const heading = /^#{1,6}\s+(.*)$/.exec(line), item = /^[-*+]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
		const text = clean(heading?.[1] ?? item?.[1] ?? line);
		if (!text) continue;
		lines.push({ kind: heading ? 'heading' : item ? 'item' : 'text', text: text.slice(0, 160) });
		if (lines.length >= max) break;
	}
	return lines;
}

// The latest published release, for the About page. Local edition only: the store edition makes no request.
export async function latestReleaseNotes(fetcher: typeof fetch = fetch, english = false): Promise<ReleaseNotes | undefined> {
	try {
		const response = await fetcher(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit' });
		if (!response.ok) return undefined;
		const release = await response.json() as { tag_name?: unknown; body?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
		const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
		if (!/^v?\d+(\.\d+)*$/.test(tag) || release.draft || release.prerelease || typeof release.body !== 'string') return undefined;
		const lines = releaseNoteLines(releaseBodyFor(release.body, english));
		if (!lines.length) return undefined;
		return { version: tag.replace(/^v/i, ''), date: typeof release.published_at === 'string' ? release.published_at.slice(0, 10) : '', lines };
	} catch { return undefined; }
}
