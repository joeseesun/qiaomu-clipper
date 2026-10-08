// The local helper cannot always read the browser's cookie file itself (macOS keeps one app's data from another's, and a helper started by
// the browser is refused). So the extension, which is inside the browser, hands over the cookies of the one site being read, in the plain
// Netscape file format yt-dlp reads. Local edition only; the store edition has no "cookies" permission and never calls this.
export interface BrowserCookie { domain: string; path: string; secure: boolean; httpOnly: boolean; expirationDate?: number; name: string; value: string }

const MAX_BYTES = 900_000;
const clean = (value: string) => value.replace(/[\t\r\n]/g, ' ');

export function netscapeCookies(cookies: ReadonlyArray<BrowserCookie>): string {
	const lines = ['# Netscape HTTP Cookie File'];
	for (const cookie of cookies) {
		if (!cookie.name || !cookie.domain) continue;
		const host = clean(cookie.domain);
		lines.push([(cookie.httpOnly ? '#HttpOnly_' : '') + host, host.startsWith('.') ? 'TRUE' : 'FALSE', clean(cookie.path || '/'), cookie.secure ? 'TRUE' : 'FALSE', String(Math.floor(cookie.expirationDate ?? 0)), clean(cookie.name), clean(cookie.value)].join('\t'));
	}
	const text = lines.join('\n') + '\n';
	return text.length > MAX_BYTES ? '' : text;
}

// The sites whose cookies a video address needs: its own, and for YouTube the Google sign-in it relies on.
export function cookieDomainsFor(address: string): string[] {
	let host: string;
	try { host = new URL(address).hostname.toLowerCase(); } catch { return []; }
	const labels = host.split('.');
	const base = labels.length > 2 && /^(com|co|org|net|gov|edu)$/.test(labels[labels.length - 2]) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
	return /(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? ['youtube.com', 'google.com'] : [base];
}

// The address a recognition job will download: the video's own page.
export function videoAddress(videoKey: string | undefined, webUrl?: string): string | undefined {
	if (!videoKey) return undefined;
	if (videoKey.startsWith('youtube:')) return `https://www.youtube.com/watch?v=${videoKey.slice(8)}`;
	if (videoKey.startsWith('bilibili:')) return 'https://www.bilibili.com/';
	if (videoKey.startsWith('web:')) return webUrl;
	return undefined;
}

export async function cookiesTxtFor(address: string | undefined, getAll: (details: { domain: string }) => Promise<BrowserCookie[]>): Promise<string> {
	if (!address) return '';
	try {
		const seen = new Set<string>(), all: BrowserCookie[] = [];
		for (const domain of cookieDomainsFor(address)) for (const cookie of await getAll({ domain })) {
			const key = `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
			if (!seen.has(key)) { seen.add(key); all.push(cookie); }
		}
		return all.length ? netscapeCookies(all) : '';
	} catch { return ''; }
}
