// Images are request-scoped. Never persist these bytes in conversation history.
export interface ChatImage { dataUrl: string; label: string }
export interface ChatTurn { role: 'user' | 'assistant'; content: string; images?: ChatImage[] }
export const MAX_CHAT_IMAGE_PARTS = 32;
export const MAX_CHAT_IMAGE_DATA = 20 * 1024 * 1024;
const IMAGE_DATA = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function imageData(image: ChatImage): { mimeType: string; data: string } {
	const match = IMAGE_DATA.exec(image.dataUrl);
	if (!match) throw new Error('Invalid chat image');
	return { mimeType: `image/${match[1]}`, data: match[2] };
}

export function validChatTurns(value: unknown): value is ChatTurn[] {
	if (!Array.isArray(value)) return false;
	let count = 0, bytes = 0;
	return value.every(turn => {
		if (!turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string') return false;
		if (turn.images === undefined) return true;
		if (turn.role !== 'user' || !Array.isArray(turn.images)) return false;
		return turn.images.every((image: ChatImage) => {
			if (!image || typeof image.label !== 'string' || image.label.length > 200 || typeof image.dataUrl !== 'string') return false;
			bytes += image.dataUrl.length; count++;
			return bytes <= MAX_CHAT_IMAGE_DATA && count <= MAX_CHAT_IMAGE_PARTS && IMAGE_DATA.test(image.dataUrl);
		});
	});
}

export function openAIContent(turn: ChatTurn): string | unknown[] {
	if (!turn.images?.length) return turn.content;
	return [{ type: 'text', text: turn.content }, ...turn.images.flatMap(image => [
		{ type: 'text', text: image.label }, { type: 'image_url', image_url: { url: image.dataUrl } },
	])];
}

export function responsesContent(turn: ChatTurn): unknown[] {
	return [{ type: turn.role === 'assistant' ? 'output_text' : 'input_text', text: turn.content },
		...(turn.images ?? []).flatMap(image => [
			{ type: 'input_text', text: image.label }, { type: 'input_image', image_url: image.dataUrl, detail: 'auto' },
		])];
}

export function anthropicContent(turn: ChatTurn): string | unknown[] {
	if (!turn.images?.length) return turn.content;
	return [{ type: 'text', text: turn.content }, ...turn.images.flatMap(image => {
		const { mimeType, data } = imageData(image);
		return [{ type: 'text', text: image.label }, { type: 'image', source: { type: 'base64', media_type: mimeType, data } }];
	})];
}

export function geminiParts(turn: ChatTurn): unknown[] {
	return [{ text: turn.content }, ...(turn.images ?? []).flatMap(image => [
		{ text: image.label }, { inlineData: imageData(image) },
	])];
}
