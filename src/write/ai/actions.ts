import { getLocalStorage, setLocalStorage } from '../../utils/storage-utils';
import { t } from '../../utils/ui-text';

// What "AI helps me change this text" can do. The built-in ones are fixed; the writer adds their own in the settings.
export interface AiActionDef { id: string; name: string; prompt: string; builtin: boolean }

const RULES = '只输出结果本身，使用 Markdown，不要解释，不要加引号或前后说明。保持原文的事实、人名、数字和链接不变。';

export const BUILTIN_PROMPTS: Record<string, string> = {
	polish: `你是资深中文编辑。润色用户给出的文字：更通顺、自然、有节奏，不改变意思和观点，不增删信息。若原文是英文则用英文润色。${RULES}`,
	shorten: `你是资深编辑。把用户给出的文字压缩到约一半长度，保留关键信息和语气。${RULES}`,
	expand: `你是写作助手。把用户给出的文字扩写得更充实：补充必要的解释、例子或过渡，但不编造事实和数据。${RULES}`,
	summarize: `你是资深编辑。用两三句话概括用户给出的文字，抓住核心结论，语言自然，不用套话。${RULES}`,
	toEnglish: `You are a translator. Translate the user's text into natural, fluent English. Output only the translation in Markdown.`,
	toChinese: `你是翻译。把用户给出的文字翻译成自然流畅的简体中文。只输出译文，使用 Markdown。`,
	continue: `你是写作助手。阅读用户给出的文章，接着最后一段自然地往下写一到两段，风格、人称和语言与前文一致，不重复已写内容，不总结。${RULES}`,
};

export const builtinActions = (): AiActionDef[] => [
	{ id: 'polish', name: t('润色'), prompt: BUILTIN_PROMPTS.polish, builtin: true },
	{ id: 'shorten', name: t('缩短'), prompt: BUILTIN_PROMPTS.shorten, builtin: true },
	{ id: 'expand', name: t('扩写'), prompt: BUILTIN_PROMPTS.expand, builtin: true },
	{ id: 'summarize', name: t('总结'), prompt: BUILTIN_PROMPTS.summarize, builtin: true },
	{ id: 'toEnglish', name: t('翻译成英文'), prompt: BUILTIN_PROMPTS.toEnglish, builtin: true },
	{ id: 'toChinese', name: t('翻译成中文'), prompt: BUILTIN_PROMPTS.toChinese, builtin: true },
];

const KEY = 'qiaomuWriteAiActions';
export const MAX_CUSTOM_ACTIONS = 20;

// Custom actions are stored with the writer's own wording; the output rules are added when the prompt is used.
export interface StoredAction { id: string; name: string; prompt: string }
export async function loadStoredActions(): Promise<StoredAction[]> {
	const raw = await getLocalStorage(KEY);
	return (Array.isArray(raw) ? raw : []).filter((a: any) => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.prompt === 'string')
		.map((a: any) => ({ id: a.id, name: a.name.trim().slice(0, 24), prompt: a.prompt.trim().slice(0, 2000) })).filter(a => a.name && a.prompt).slice(0, MAX_CUSTOM_ACTIONS);
}
export async function saveStoredActions(actions: StoredAction[]): Promise<void> { await setLocalStorage(KEY, actions.slice(0, MAX_CUSTOM_ACTIONS)); }

let cache: AiActionDef[] | undefined;
export async function allActions(refresh = false): Promise<AiActionDef[]> {
	if (!cache || refresh) cache = [...builtinActions(), ...(await loadStoredActions()).map(a => ({ id: a.id, name: a.name, prompt: `你是写作助手。按下面的要求处理用户给出的文字。要求：${a.prompt}。${RULES}`, builtin: false }))];
	return cache;
}
export function invalidateActions(): void { cache = undefined; }
