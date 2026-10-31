import { enabledChatModels, streamChat } from '../../utils/chat-llm';
import { getLocalStorage } from '../../utils/storage-utils';
import { t } from '../../utils/ui-text';

// One-shot helpers around the article's title and summary: ask the chosen model, return plain text.
async function ask(system: string, content: string): Promise<string> {
	const models = enabledChatModels();
	if (!models.length) throw new Error(t('还没有可用的 AI 模型，请先在设置里添加'));
	const saved = await getLocalStorage('qiaomuChatModel');
	const model = models.find(m => m.id === saved) ?? models[0];
	let out = '';
	await streamChat({ model, system, messages: [{ role: 'user', content }], onDelta: delta => { out += delta; } });
	return out.trim();
}

const clip = (markdown: string) => markdown.slice(0, 8000);

export function parseTitles(text: string): string[] {
	const seen = new Set<string>();
	return text.split('\n').map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').replace(/^["“《「]+|["”》」]+$/g, '').trim()).filter(line => line && line.length <= 80 && !seen.has(line) && !!seen.add(line)).slice(0, 8);
}

export async function suggestTitles(title: string, markdown: string): Promise<string[]> {
	const text = await ask('你是资深编辑。根据文章内容拟 5 个标题：有吸引力但不标题党，不夸大，不用感叹号，每个不超过 30 字。每行一个，不要编号，不要解释。', `现有标题：${title || '（无）'}\n\n${clip(markdown)}`);
	return parseTitles(text);
}

export async function suggestDigest(title: string, markdown: string): Promise<string> {
	const text = await ask('你是资深编辑。为文章写一段摘要：一到两句话，不超过 100 字，自然、有信息量，不用套话，不以“本文”开头。只输出摘要本身。', `标题：${title || '（无）'}\n\n${clip(markdown)}`);
	return text.replace(/^["“「]+|["”」]+$/g, '').trim().slice(0, 300);
}

export async function suggestCoverPrompt(title: string, digest: string, markdown: string): Promise<string> {
	const text = await ask('你是视觉编辑。为文章写一段文生图提示词，用于文章封面：描述主体、场景、风格、构图和色调，画面里不要出现文字、logo 或水印。用中文，80 到 160 字，只输出提示词本身。', `标题：${title || '（无）'}\n摘要：${digest || '（无）'}\n\n${clip(markdown).slice(0, 3000)}`);
	return text.replace(/^["“「]+|["”」]+$/g, '').trim();
}
