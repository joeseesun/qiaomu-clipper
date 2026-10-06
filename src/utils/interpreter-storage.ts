import type { Settings } from '../types/types';

export const INTERPRETER_KEY = 'interpreter_settings';
const CHUNK_PREFIX = 'interpreter_settings_chunk_';
const ITEM_BUDGET = 7000; // Leave room below Chrome sync's 8192-byte item limit.
type InterpreterSettings = Pick<Settings, 'interpreterModel' | 'models' | 'providers' | 'interpreterEnabled' | 'interpreterAutoRun' | 'defaultPromptContext'>;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function interpreterChunkKeys(value: unknown): string[] {
	const count = (value as { chunkCount?: number })?.chunkCount;
	return (value as { chunked?: number })?.chunked === 1 && Number.isInteger(count) && count! > 0 && count! <= 512
		? Array.from({ length: count! }, (_, i) => `${CHUNK_PREFIX}${i}`) : [];
}

export function encodeInterpreterSettings(settings: InterpreterSettings): Record<string, unknown> {
	if (bytes(settings) + INTERPRETER_KEY.length <= ITEM_BUDGET) return { [INTERPRETER_KEY]: settings };
	const chunks: string[] = [];
	let chunk = '';
	let size = 2 + CHUNK_PREFIX.length + 3;
	// Count JSON-escaped UTF-8 bytes, including non-ASCII names and token contents.
	for (const char of JSON.stringify(settings)) {
		const cost = bytes(char) - 2;
		if (size + cost > ITEM_BUDGET) { chunks.push(chunk); chunk = ''; size = 2 + CHUNK_PREFIX.length + 3; }
		chunk += char; size += cost;
	}
	if (chunk) chunks.push(chunk);
	return { [INTERPRETER_KEY]: { chunked: 1, chunkCount: chunks.length }, ...Object.fromEntries(chunks.map((value, i) => [`${CHUNK_PREFIX}${i}`, value])) };
}

export function decodeInterpreterSettings(data: Record<string, unknown>): InterpreterSettings | undefined {
	const value = data[INTERPRETER_KEY];
	if ((value as { chunked?: number })?.chunked !== 1) return value as InterpreterSettings | undefined;
	const keys = interpreterChunkKeys(value);
	if (!keys.length || keys.some(key => typeof data[key] !== 'string')) throw new Error('Incomplete AI settings; please retry after browser sync completes.');
	return JSON.parse(keys.map(key => data[key]).join('')) as InterpreterSettings;
}
