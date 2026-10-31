import { Node, mergeAttributes } from '@tiptap/core';
import { embedPlugin, parseEmbedUrl } from './markdown-plugins';
import { h } from './dom';
import { t } from '../../utils/ui-text';

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		embed: { insertEmbed: (url: string) => ReturnType };
	}
}

interface TweetPreview { author: string; text: string }
const tweetCache = new Map<string, Promise<TweetPreview | undefined>>();

// The public oEmbed answer carries a ready-made blockquote; only its text is used (no remote script ever runs here).
function loadTweet(url: string): Promise<TweetPreview | undefined> {
	let pending = tweetCache.get(url);
	if (!pending) {
		pending = fetch(`https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`)
			.then(response => response.ok ? response.json() : undefined)
			.then(data => {
				if (!data?.html) return undefined;
				const doc = new DOMParser().parseFromString(String(data.html), 'text/html');
				const text = Array.from(doc.querySelectorAll('blockquote > p')).map(p => p.textContent ?? '').join('\n').trim();
				return { author: String(data.author_name ?? ''), text };
			})
			.catch(() => undefined);
		tweetCache.set(url, pending);
	}
	return pending;
}

function frameFor(kind: string, id: string): string | undefined {
	if (kind === 'youtube') return `https://www.youtube-nocookie.com/embed/${id}`;
	if (kind === 'bilibili') return `https://player.bilibili.com/player.html?bvid=${id}&autoplay=0&high_quality=1`;
	if (kind === 'vimeo') return `https://player.vimeo.com/video/${id}`;
	return undefined;
}

function render(dom: HTMLElement, src: string): void {
	dom.textContent = '';
	const info = parseEmbedUrl(src);
	const link = h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', text: src });
	if (!info) { dom.append(link); return; }
	if (info.kind === 'tweet') {
		const author = h('div', { class: 'qw-embed-author', text: 'X' });
		const text = h('div', { class: 'qw-embed-text', text: t('正在读取推文…') });
		dom.append(author, text, h('div', { class: 'qw-embed-link' }, link));
		void loadTweet(info.url).then(preview => {
			if (!dom.isConnected && !dom.parentElement) return;
			if (preview) { author.textContent = preview.author || 'X'; text.textContent = preview.text; }
			else text.textContent = t('无法读取这条推文，发布时仍会按链接嵌入');
		});
		return;
	}
	const frame = frameFor(info.kind, info.id);
	if (frame) dom.append(h('div', { class: 'qw-embed-frame' }, h('iframe', { src: frame, allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups', title: info.kind })), h('div', { class: 'qw-embed-link' }, link));
}

export const Embed = Node.create({
	name: 'embed',
	group: 'block',
	atom: true,
	draggable: true,
	selectable: true,
	addAttributes() {
		return {
			src: { default: '', parseHTML: el => el.getAttribute('data-src') ?? '' },
			kind: { default: '', parseHTML: el => el.getAttribute('data-kind') ?? '' },
		};
	},
	parseHTML() { return [{ tag: 'div[data-type="embed"]' }]; },
	renderHTML({ node, HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed', 'data-kind': node.attrs.kind, 'data-src': node.attrs.src }), ['a', { href: node.attrs.src }, node.attrs.src]];
	},
	addStorage() {
		return {
			markdown: {
				// A link alone on its line: other tools show it as a link, this editor shows it as a card.
				serialize(state: any, node: any) { state.write(node.attrs.src); state.closeBlock(node); },
				parse: { setup(md: any) { embedPlugin(md); } },
			},
		};
	},
	addCommands() {
		return {
			insertEmbed: (url: string) => ({ commands }) => {
				const info = parseEmbedUrl(url);
				return info ? commands.insertContent({ type: this.name, attrs: { src: info.url, kind: info.kind } }) : false;
			},
		};
	},
	addNodeView() {
		return ({ node }) => {
			const dom = h('div', { class: 'qw-embed', contentEditable: 'false' });
			let src = node.attrs.src as string;
			render(dom, src);
			return {
				dom,
				update(updated) { if (updated.type.name !== 'embed') return false; if (updated.attrs.src !== src) { src = updated.attrs.src; render(dom, src); } return true; },
				ignoreMutation: () => true,
				stopEvent: (event: Event) => event.target instanceof HTMLIFrameElement,
			};
		};
	},
});
