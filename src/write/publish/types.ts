import type { Article, PublishRecord, PublishTarget } from '../types';

export interface PublishRequest {
	article: Article;
	markdown: string;
	// Called once the platform has accepted the article, so the list can show where it went.
	onRecorded: (record: PublishRecord) => void;
}

// A place an article can be sent to. X is first; WeChat Official Accounts follow the same shape
// (render Markdown to themed HTML, upload the pictures, create a draft).
export interface Publisher {
	id: PublishTarget;
	label: () => string;
	hint: () => string;
	run: (request: PublishRequest) => Promise<void>;
}
