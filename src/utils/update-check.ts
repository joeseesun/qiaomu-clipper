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
