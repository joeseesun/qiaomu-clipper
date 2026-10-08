// Refresh src/utils/model-names.json: friendly model names from https://models.dev for the vendors in our catalogue.
// Only names are kept (no prices, no keys) so the extension stays offline-friendly. Run: node scripts/update-model-names.mjs
import { writeFileSync } from 'node:fs';
const VENDORS = ['openai', 'anthropic', 'google', 'deepseek', 'moonshotai-cn', 'moonshotai', 'zhipuai', 'zai', 'alibaba-cn', 'alibaba', 'minimax-cn', 'minimax', 'stepfun', 'xai', 'mistral', 'groq', 'perplexity', 'siliconflow-cn', 'siliconflow', 'togetherai', 'fireworks-ai', 'cerebras', 'meta', 'nvidia', 'volcengine', 'tencent-tokenhub', 'xiaomi'];
const data = await (await fetch('https://models.dev/api.json')).json();
const names = {};
for (const vendor of VENDORS) for (const model of Object.values(data[vendor]?.models || {})) {
	const id = String(model.id || '').toLowerCase(), name = String(model.name || '').trim();
	if (id && name && name.toLowerCase() !== id && !(id in names)) names[id] = name;
}
const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL('../src/utils/model-names.json', import.meta.url), JSON.stringify(sorted) + '\n');
console.log(Object.keys(sorted).length, 'names');
