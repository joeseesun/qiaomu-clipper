export function youtubeVideoId(sourceUrl: string): string | null {
	let source: URL;
	try { source = new URL(sourceUrl); } catch { return null; }
	if (!/^https?:$/.test(source.protocol)) return null;
	const host = source.hostname.toLowerCase();
	if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return null;
	const id = host === 'youtu.be' ? source.pathname.slice(1).split('/')[0]
		: source.pathname === '/watch' ? source.searchParams.get('v') : source.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
	return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}

export function youtubeStudyPath(url: string, sourceTabId: number, title = '', timestamp = 0, autoplay = false): string | null {
	if (!youtubeVideoId(url)) return null;
	const time = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
	return `reader.html?study=youtube&url=${encodeURIComponent(url)}&sourceTab=${sourceTabId}&title=${encodeURIComponent(title)}${time ? `&t=${time}` : ''}${autoplay ? '&autoplay=1' : ''}`;
}
