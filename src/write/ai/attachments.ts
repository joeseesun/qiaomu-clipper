import { getArticle } from '../articles';
import type { ChatImage } from '../../utils/chat-content';
import { t } from '../../utils/ui-text';

// What the writer attaches to a question besides the article itself: pictures, web pages and other articles in the library.
export type Attachment =
	| { kind: 'image'; id: string; label: string; dataUrl: string }
	| { kind: 'web'; id: string; label: string; url: string; text: string }
	| { kind: 'article'; id: string; label: string; articleId: string; text: string };

export const MAX_ATTACHMENTS = 6;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_EDGE = 1568;
const MAX_IMAGE_DATA = 4 * 1024 * 1024;

const newId = () => `att_${Math.random().toString(36).slice(2, 10)}`;

function publicIpv4(host: string): boolean {
	const parts = host.split('.').map(Number);
	if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
	const [a, b] = parts;
	return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0));
}

// Only public pages: nothing on this computer or inside a private network is fetched on the writer's behalf.
export function checkedWebUrl(input: string): URL {
	let url: URL;
	try { url = new URL(input.trim()); } catch { throw new Error(t('请输入完整的网页地址')); }
	if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(t('只能读取公开的 HTTP 或 HTTPS 网页'));
	const host = url.hostname.toLowerCase();
	const ipv4 = /^\d+(?:\.\d+){3}$/.test(host);
	if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') || (ipv4 && !publicIpv4(host))) throw new Error(t('不能读取本机或内网地址'));
	return url;
}

export function extractWebText(html: string): { title: string; text: string } {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	doc.querySelectorAll('script,style,noscript,svg,nav,footer,header,aside,form,iframe').forEach(node => node.remove());
	const title = doc.title.trim();
	const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;
	const text = (root?.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (!text) throw new Error(t('这个网页没有可读取的正文，可能需要登录，或内容由脚本动态加载'));
	return { title, text };
}

export async function webAttachment(input: string, signal?: AbortSignal): Promise<Attachment> {
	const url = checkedWebUrl(input);
	const timeout = AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
	const response = await fetch(url.href, { credentials: 'omit', redirect: 'follow', signal: signal && timeout && (AbortSignal as any).any ? (AbortSignal as any).any([signal, timeout]) : signal ?? timeout });
	if (!response.ok) throw new Error(t('网页返回了 {0}', [response.status]));
	const final = checkedWebUrl(response.url || url.href);
	const type = response.headers.get('content-type') ?? '';
	if (!/html|xml|text\/plain/i.test(type)) throw new Error(t('这个地址不是网页'));
	const raw = await response.text();
	if (new TextEncoder().encode(raw).length > MAX_PAGE_BYTES) throw new Error(t('网页超过附件读取上限，请下载正文后粘贴到对话框。'));
	const { title, text } = /xml/i.test(type) && !/html/i.test(type) ? { title: '', text: raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() } : extractWebText(raw);
	return { kind: 'web', id: newId(), label: title || final.hostname, url: final.href, text };
}

export async function articleAttachment(articleId: string): Promise<Attachment> {
	const article = await getArticle(articleId);
	if (!article) throw new Error(t('找不到这篇文章'));
	return { kind: 'article', id: newId(), label: article.title.trim() || t('未命名文章'), articleId, text: article.markdown };
}

// A picture the model can read: scaled down, then PNG or JPEG.
export async function imageAttachment(file: File): Promise<Attachment> {
	if (!file.type.startsWith('image/')) throw new Error(t('这不是图片'));
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(t('这张图片读不出来'))); image.src = url; });
		const ratio = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		let dataUrl = canvas.toDataURL('image/jpeg', 0.88);
		if (dataUrl.length > MAX_IMAGE_DATA) dataUrl = canvas.toDataURL('image/jpeg', 0.6);
		if (dataUrl.length > MAX_IMAGE_DATA) throw new Error(t('图片太大了'));
		return { kind: 'image', id: newId(), label: file.name || t('图片'), dataUrl };
	} finally { URL.revokeObjectURL(url); }
}

// The text of web pages and other articles, fenced so the model can tell them from the writer's own words.
export function referenceContext(list: Attachment[]): string {
	return list.flatMap(item => item.kind === 'web' ? [`<网页 标题="${item.label}" 地址="${item.url}">\n${item.text}\n</网页>`] : item.kind === 'article' ? [`<文章 标题="${item.label}">\n${item.text}\n</文章>`] : []).join('\n\n');
}
export const imagesOf = (list: Attachment[]): ChatImage[] => list.flatMap(item => (item.kind === 'image' ? [{ dataUrl: item.dataUrl, label: item.label }] : []));
