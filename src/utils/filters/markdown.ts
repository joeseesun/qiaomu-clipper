import { createMarkdownContent } from '../defuddle';

export const markdown = (str: string, param?: string): string => {
	const baseUrl = param || 'about:blank';
	try {
		return createMarkdownContent(str, baseUrl);
	} catch (error) {
		console.error('Error in createMarkdownContent:', error);
		return str;
	}
};