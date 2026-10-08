import browser from './browser-polyfill';

import { t } from './ui-text';
// Which sites "transcribe and study" works on. The first three have their own pages (a bar on the site, a study page with a
// player); the rest are sites yt-dlp can read, studied from their address. Everything is on until the viewer turns it off.
export interface StudySite { id: string; name: string; hosts: string[]; builtin?: boolean; note?: string }
export const STUDY_SITES: StudySite[] = [
	{ id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], builtin: true, get note() { return t('字幕条、沉浸学习'); } },
	{ id: 'bilibili', get name() { return t('哔哩哔哩'); }, hosts: ['bilibili.com', 'b23.tv'], builtin: true, get note() { return t('字幕条、沉浸学习'); } },
	{ id: 'xiaoyuzhou', get name() { return t('小宇宙'); }, hosts: ['xiaoyuzhoufm.com'], builtin: true, get note() { return t('字幕条、沉浸学习'); } },
	{ id: 'vimeo', name: 'Vimeo', hosts: ['vimeo.com'] },
	{ id: 'x', name: 'X（Twitter）', hosts: ['x.com', 'twitter.com'], get note() { return t('帖子里的视频或音频：字幕条，按 A 三次进入学习'); } },
	{ id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'] },
	{ id: 'douyin', get name() { return t('抖音'); }, hosts: ['douyin.com'], get note() { return t('多数需要登录状态'); } },
	{ id: 'instagram', name: 'Instagram', hosts: ['instagram.com'], get note() { return t('多数需要登录状态'); } },
	{ id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.watch'] },
	{ id: 'reddit', name: 'Reddit', hosts: ['reddit.com', 'v.redd.it'] },
	{ id: 'twitch', name: 'Twitch', hosts: ['twitch.tv'] },
	{ id: 'dailymotion', name: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'] },
	{ id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com'] },
	{ id: 'bandcamp', name: 'Bandcamp', hosts: ['bandcamp.com'] },
	{ id: 'niconico', name: 'niconico', hosts: ['nicovideo.jp', 'nico.ms'] },
	{ id: 'weibo', get name() { return t('微博视频'); }, hosts: ['weibo.com', 'weibo.cn'] },
	{ id: 'ximalaya', get name() { return t('喜马拉雅'); }, hosts: ['ximalaya.com'] },
	{ id: 'netease', get name() { return t('网易云音乐'); }, hosts: ['music.163.com'] },
	{ id: 'ted', name: 'TED', hosts: ['ted.com'] },
	{ id: 'applepodcasts', get name() { return t('Apple 播客'); }, hosts: ['podcasts.apple.com'] },
];
export interface StudySites { off: string[]; other: boolean }
export const defaultStudySites = (): StudySites => ({ off: [], other: true });
const KEY = 'qiaomuStudySites';

export function cleanStudySites(value: unknown): StudySites {
	const v = (value && typeof value === 'object' ? value : {}) as Partial<StudySites>, known = new Set(STUDY_SITES.map(site => site.id));
	return { off: Array.isArray(v.off) ? Array.from(new Set(v.off.filter((id): id is string => typeof id === 'string' && known.has(id)))) : [], other: v.other !== false };
}
export async function loadStudySites(): Promise<StudySites> {
	try { return cleanStudySites((await browser.storage.local.get(KEY))[KEY]); } catch { return defaultStudySites(); }
}
export async function saveStudySites(sites: StudySites): Promise<StudySites> {
	const next = cleanStudySites(sites); await browser.storage.local.set({ [KEY]: next }); return next;
}
export const isSiteOn = (sites: StudySites, id: string): boolean => !sites.off.includes(id);
export const STUDY_SITES_KEY = KEY;

// A post on X: the address of the post itself (a video or audio in it is what gets studied), without the query or the photo/video suffix.
export function xStatus(address: string): string | null {
	try {
		const url = new URL(address); if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname.toLowerCase())) return null;
		const match = url.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})|i)\/status\/(\d{5,25})(?:\/|$)/); if (!match) return null;
		return `https://x.com/${match[1] ?? 'i'}/status/${match[2]}`;
	} catch { return null; }
}

// The site an address belongs to (by host name, subdomains included).
export function siteOf(address: string): StudySite | undefined {
	let host: string;
	try { const url = new URL(address); if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined; host = url.hostname.toLowerCase(); } catch { return undefined; }
	return STUDY_SITES.find(site => site.hosts.some(item => host === item || host.endsWith('.' + item)));
}
