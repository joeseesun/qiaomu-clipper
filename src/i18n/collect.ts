import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { staticUnits } from '../utils/ui-text';

// Strings the code passes to t() that are not literals at the call (tables read at use), so they cannot be found by reading the calls.
export const TABLE_STRINGS = [
	'哔哩哔哩', '播客', '本地文件', '其他网站', '速度最快，时间轴最准', 'Qwen3-ASR，中文术语识别准确', '更多网站…',
];

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { if (!['_locales', 'i18n', 'icons'].includes(entry.name)) walk(full, out); }
		else out.push(full);
	}
	return out;
}

// Every string written as t('…') in the source, with {0} for template pieces.
export function sourceStrings(): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of walk(SRC).filter(item => /\.ts$/.test(item) && !/\.(test|d)\.ts$/.test(item))) {
		const text = fs.readFileSync(file, 'utf8');
		if (!/from '[^']*utils\/ui-text'|from '\.\/ui-text'|from '\.\.\/utils\/ui-text'/.test(text) && !/ui-text'/.test(text)) continue;
		const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node) => {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments.length) {
				const arg = node.arguments[0];
				if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) found.set(arg.text, path.relative(SRC, file));
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	for (const text of TABLE_STRINGS) found.set(text, 'tables');
	return found;
}

// Every piece of Chinese text in the HTML pages.
export function pageStrings(): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of fs.readdirSync(SRC).filter(item => item.endsWith('.html'))) {
		const document = new DOMParser().parseFromString(fs.readFileSync(path.join(SRC, file), 'utf8'), 'text/html');
		for (const unit of staticUnits(document.body)) found.set(unit.source, file);
	}
	return found;
}
