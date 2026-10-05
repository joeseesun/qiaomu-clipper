import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Rules from CLAUDE.md that broke before and are cheap to check by machine.
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

it('keeps the reader\'s svg blending away from our own icons (a white icon on a dark button vanishes otherwise)', () => {
	expect(source('./audio-study.ts')).toMatch(/\.qa-player svg\{mix-blend-mode:normal!important/);
	expect(source('./subtitle-generation-dialog.ts')).toMatch(/svg\{mix-blend-mode:normal!important/);
});

it('gives sticky surfaces a solid background, not only a tint', () => {
	const style = source('./audio-study.ts');
	expect(style).toMatch(/\.player-container\{position:sticky/);
	expect(style).toMatch(/background:linear-gradient\(.*\),var\(--background-primary,#fff\);/);
});

it('scopes our buttons so the app\'s global button rules (and their :hover) cannot win', () => {
	for (const file of ['./subtitle-generation-panel.ts', './subtitle-generation-dialog.ts', './audio-study.ts']) {
		const css = source(file);
		expect(css, file).not.toMatch(/\n\.qiaomu-yt-gen-button\{/); // an unscoped rule would lose to buttons.scss
	}
	expect(source('./subtitle-generation-panel.ts')).toContain('html button.qiaomu-yt-gen-button:not(.qg-x){display:inline-flex');
	expect(source('./subtitle-generation-dialog.ts')).toMatch(/\.qiaomu-dlg-wrap \.qiaomu-dlg \.qiaomu-dlg-btn\{/);
});

it('names buttons after the result, and keeps technical wording out of the buttons', () => {
	const strings = source('./subtitle-generation-strings.ts');
	for (const key of ['start', 'startCloud']) expect(strings).toMatch(new RegExp(`${key}: text\\('[^']+', '生成字幕'`));
	expect(strings).not.toMatch(/上传音频并/);
	expect(strings).toMatch(/regenerate: text\('[^']+', '换模型生成文字稿'/);
});
