// A long article written in the clipper. Markdown is the single source of truth; pictures live in the image store
// and appear in the text as `qm-image://<id>`.
export type PublishTarget = 'x' | 'wechat';

export interface PublishRecord {
	at: number;
	url?: string;
	// WeChat draft id, X draft id: whatever lets a later "send again" update instead of duplicate.
	remoteId?: string;
	account?: string;
}

export interface Article {
	id: string;
	title: string;
	markdown: string;
	// Shown on the list and used as the X / WeChat cover. An image id from the image store, or empty.
	coverImageId: string;
	author: string;
	digest: string;
	sourceUrl: string;
	createdAt: number;
	updatedAt: number;
	// Set while the article sits in the trash.
	trashedAt?: number;
	wordCount: number;
	publishes: Partial<Record<PublishTarget, PublishRecord>>;
	// Bumped on every save; a second tab with an older revision must reload instead of overwriting.
	revision: number;
	clipSource?: { previewId: string; readUrl: string; waitingForCaptions: boolean; initialMarkdown?: string };
}

export type ArticleSummary = Omit<Article, 'markdown'> & { excerpt: string };

export interface StoredImage {
	id: string;
	blob: Blob;
	mime: string;
	width: number;
	height: number;
	hash: string;
	name: string;
	createdAt: number;
}

export const IMAGE_SCHEME = 'qm-image://';
