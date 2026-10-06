import { BRAND_ICONS } from './provider-icons';
import { CHATGPT_BASE, CODEX_BASE } from './oauth/accounts';

export type ProviderGroup = 'account' | 'provider' | 'relay' | 'local';

export interface CatalogEntry {
	id: string;
	name: string;
	group: ProviderGroup;
	// one short line under the name: a plan, or where it lives
	sub: string;
	icon?: keyof typeof BRAND_ICONS;
	baseUrl: string;
	apiKeyUrl?: string;
	apiKeyRequired?: boolean;
	modelsList?: string;
	signIn?: 'tokendance' | 'chatgpt' | 'codex';
	popularModels?: Array<{ id: string; name: string; recommended?: boolean }>;
	hue?: number;
}

// Ordered as the picker shows them: logging in is easier than pasting a key, so it comes first.
export const CATALOG: CatalogEntry[] = [
	{ id: 'chatgpt', name: 'ChatGPT', group: 'account', sub: 'Plus · Pro · Business', icon: 'openai', baseUrl: `${CHATGPT_BASE}/responses`, apiKeyRequired: false, signIn: 'chatgpt' },
	{ id: 'codex', name: 'Codex', group: 'account', sub: 'ChatGPT 套餐里的 Codex', icon: 'codex', baseUrl: `${CODEX_BASE}/responses`, apiKeyRequired: false, signIn: 'codex' },

	{ id: 'tokendance', name: '词元跳动', group: 'relay', sub: 'tokendance.space · 一个 Key 用所有模型', baseUrl: 'https://tokendance.space/gateway/v1/chat/completions', apiKeyUrl: 'https://tokendance.space/keys', apiKeyRequired: true, signIn: 'tokendance', modelsList: 'https://tokendance.space/models', hue: 262,
		popularModels: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', recommended: true }, { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' }, { id: 'kimi-k3', name: 'Kimi K3' }] },
	{ id: 'siliconflow', name: '硅基流动', group: 'relay', sub: 'api.siliconflow.cn', icon: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions', apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak', apiKeyRequired: true, modelsList: 'https://cloud.siliconflow.cn/models' },
	{ id: 'openrouter', name: 'OpenRouter', group: 'relay', sub: 'openrouter.ai', icon: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/chat/completions', apiKeyUrl: 'https://openrouter.ai/settings/keys', apiKeyRequired: true },
	{ id: 'opencode-go', name: 'OpenCode Go', group: 'relay', sub: 'opencode.ai · Go 订阅里的编码模型', icon: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions', apiKeyUrl: 'https://opencode.ai/auth', apiKeyRequired: true,
		popularModels: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', recommended: true }, { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' }, { id: 'kimi-k3', name: 'Kimi K3' }, { id: 'longcat-2.0', name: 'LongCat-2.0' }, { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6 Flash' }] },

	{ id: 'openai', name: 'OpenAI', group: 'provider', sub: 'api.openai.com', icon: 'openai', baseUrl: 'https://api.openai.com/v1/chat/completions', apiKeyUrl: 'https://platform.openai.com/api-keys', apiKeyRequired: true },
	{ id: 'anthropic', name: 'Anthropic', group: 'provider', sub: 'api.anthropic.com', icon: 'anthropic', baseUrl: 'https://api.anthropic.com/v1/messages', apiKeyUrl: 'https://console.anthropic.com/settings/keys', apiKeyRequired: true },
	{ id: 'google-gemini', name: 'Google Gemini', group: 'provider', sub: 'Gemini Developer API', icon: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model-id}:generateContent', apiKeyUrl: 'https://aistudio.google.com/app/apikey', apiKeyRequired: true },
	{ id: 'deepseek', name: 'DeepSeek', group: 'provider', sub: 'api.deepseek.com', icon: 'deepseek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', apiKeyUrl: 'https://platform.deepseek.com/api_keys', apiKeyRequired: true },
	{ id: 'moonshot-cn', name: 'Kimi', group: 'provider', sub: 'api.moonshot.cn', icon: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys', apiKeyRequired: true },
	{ id: 'zhipu', name: '智谱 GLM', group: 'provider', sub: 'open.bigmodel.cn', icon: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', apiKeyRequired: true },
	{ id: 'qwen-cn', name: '通义千问', group: 'provider', sub: '阿里云百炼', icon: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1', apiKeyRequired: true },
	{ id: 'doubao', name: '豆包', group: 'provider', sub: '火山方舟', icon: 'doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', apiKeyRequired: true },
	{ id: 'minimax-cn', name: 'MiniMax', group: 'provider', sub: 'api.minimaxi.com', icon: 'minimax', baseUrl: 'https://api.minimaxi.com/v1/chat/completions', apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', apiKeyRequired: true },
	{ id: 'stepfun', name: '阶跃星辰', group: 'provider', sub: 'api.stepfun.com', icon: 'stepfun', baseUrl: 'https://api.stepfun.com/v1/chat/completions', apiKeyUrl: 'https://platform.stepfun.com/interface-key', apiKeyRequired: true },
	{ id: 'xai', name: 'xAI', group: 'provider', sub: 'api.x.ai', icon: 'xai', baseUrl: 'https://api.x.ai/v1/chat/completions', apiKeyUrl: 'https://console.x.ai', apiKeyRequired: true },
	{ id: 'mistral', name: 'Mistral', group: 'provider', sub: 'api.mistral.ai', icon: 'mistral', baseUrl: 'https://api.mistral.ai/v1/chat/completions', apiKeyUrl: 'https://console.mistral.ai/api-keys', apiKeyRequired: true },
	{ id: 'groq', name: 'Groq', group: 'provider', sub: 'api.groq.com', icon: 'groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKeyUrl: 'https://console.groq.com/keys', apiKeyRequired: true },
	{ id: 'perplexity', name: 'Perplexity', group: 'provider', sub: 'api.perplexity.ai', icon: 'perplexity', baseUrl: 'https://api.perplexity.ai/chat/completions', apiKeyUrl: 'https://www.perplexity.ai/settings/api', apiKeyRequired: true },

	{ id: 'ollama', name: 'Ollama', group: 'local', sub: '本机模型', icon: 'ollama', baseUrl: 'http://127.0.0.1:11434/api/chat', apiKeyRequired: false },
	{ id: 'lmstudio', name: 'LM Studio', group: 'local', sub: '本机 :1234', baseUrl: 'http://127.0.0.1:1234/v1/chat/completions', apiKeyRequired: false, hue: 200 }
];

export const GROUP_ORDER: ProviderGroup[] = ['account', 'relay', 'provider', 'local'];

const HOST_ICONS: Array<[RegExp, keyof typeof BRAND_ICONS]> = [
	[/chatgpt\.com|api\.openai\.com/, 'openai'], [/anthropic\.com/, 'anthropic'], [/googleapis\.com/, 'gemini'], [/deepseek/, 'deepseek'],
	[/moonshot/, 'moonshot'], [/bigmodel|z\.ai/, 'zhipu'], [/dashscope|aliyun/, 'qwen'], [/volces|volcengine/, 'doubao'], [/minimax/, 'minimax'],
	[/stepfun/, 'stepfun'], [/x\.ai/, 'xai'], [/mistral/, 'mistral'], [/groq/, 'groq'], [/perplexity/, 'perplexity'], [/siliconflow/, 'siliconflow'],
	[/openrouter/, 'openrouter'], [/11434|ollama/, 'ollama'], [/huggingface/, 'huggingface'], [/meta\.ai/, 'meta'], [/openai\.azure/, 'azure'], [/nvidia/, 'nvidia'], [/opencode\.ai/, 'opencode']
];

// The brand a saved provider belongs to: by preset, else by where it points, else by name.
export function brandOf(provider: { presetId?: string; baseUrl?: string; name?: string }): CatalogEntry | undefined {
	const byId = CATALOG.find(e => e.id === provider.presetId);
	if (byId) return byId;
	const url = (provider.baseUrl || '').toLowerCase();
	const byUrl = CATALOG.find(e => e.group !== 'account' && e.baseUrl && new URL(e.baseUrl.replace(/[{}]/g, ''), 'https://x').host === safeHost(url));
	if (byUrl) return byUrl;
	return CATALOG.find(e => e.name === provider.name);
}

function safeHost(url: string): string { try { return new URL(url).host; } catch { return ''; } }

const hueOf = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

// An icon tile (a div, never a button: the app stretches buttons full width).
export function iconTile(provider: { presetId?: string; baseUrl?: string; name?: string }, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
	const tile = document.createElement('span');
	tile.className = `provider-tile is-${size}`;
	const brand = brandOf(provider);
	const key = brand?.icon || HOST_ICONS.find(([re]) => re.test((provider.baseUrl || '').toLowerCase()))?.[1];
	if (key && BRAND_ICONS[key]) {
		tile.innerHTML = BRAND_ICONS[key];
	} else {
		const name = brand?.name || provider.name || '?';
		tile.classList.add('is-letter');
		tile.style.setProperty('--h', String(brand?.hue ?? hueOf(name)));
		tile.textContent = [...name.trim()][0]?.toUpperCase() || '?';
	}
	return tile;
}
