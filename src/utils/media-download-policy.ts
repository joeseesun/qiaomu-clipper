// Policy for saving media files, separate from playback and transcript retrieval.
// Check the original page AND media host: an embedded player can be on another site.
const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'youtube.googleapis.com'];
function httpsUrl(value: string): URL | undefined {
 try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url : undefined; } catch { return; }
}
export function isYouTubeDownloadUrl(value: string): boolean {
 const url = httpsUrl(value); if (!url) return false;
 const host = url.hostname.toLowerCase().replace(/\.+$/, '');
 return YOUTUBE_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
}
// A YouTube watch page itself (never a media host): the only YouTube address the standalone edition may hand to the helper.
export function isYouTubePageUrl(value: string): boolean {
 const url = httpsUrl(value); if (!url) return false;
 const host = url.hostname.toLowerCase().replace(/\.+$/, '');
 return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
}
// Standalone edition only: YouTube files are fetched by the helper from the page address, never from a signed media address.
export function canDownloadYouTube(sourceUrl: string, mediaUrl: string, localEdition = __LOCAL_EDITION__): boolean {
 return localEdition && isYouTubePageUrl(sourceUrl) && !mediaUrl;
}
export function canDownloadMedia(sourceUrl: string, mediaUrl: string, localEdition = __LOCAL_EDITION__): boolean {
 const media = httpsUrl(mediaUrl);
 if (!media || /\.(?:m3u8|mpd)(?:$|[?#])/i.test(media.href)) return false;
 if (localEdition) return true;
 return Boolean(httpsUrl(sourceUrl)) && !isYouTubeDownloadUrl(sourceUrl) && !isYouTubeDownloadUrl(mediaUrl);
}
