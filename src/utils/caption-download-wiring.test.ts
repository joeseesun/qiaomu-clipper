import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
// Every page script that draws the subtitle bar must hand it the format words and follow the setting live.
it.each(['youtube-panel-content.ts', 'bilibili-panel-content.ts', 'xiaoyuzhou-content.ts', 'web-content.ts'])('%s gives the bar the download formats and follows the setting', file => {
	const source = read(file);
	expect(source).toContain('watchDownloadFormat(api, pref => { downloadPref = pref; })');
	expect(source).toContain('download: { strings: downloadStrings(text), preference: () => downloadPref }');
});

it('lists no other page script that builds the bar without them', () => {
	const builders = fs.readdirSync(path.resolve(__dirname, '..')).filter(file => /\.ts$/.test(file) && !/\.test\.ts$/.test(file) && read(file).includes('buildTranscriptBar('));
	expect(builders.sort()).toEqual(['bilibili-panel-content.ts', 'web-content.ts', 'xiaoyuzhou-content.ts', 'youtube-panel-content.ts']);
});

it('saves the choice in general settings and offers it on the settings page', () => {
	expect(read('settings.html')).toMatch(/id="caption-download-format"[\s\S]*value="ask"[\s\S]*value="md"[\s\S]*value="srt"[\s\S]*value="vtt"[\s\S]*value="txt"/);
	expect(read('managers/general-settings.ts')).toContain("'caption-download-format'");
	expect(read('utils/storage-utils.ts').match(/captionDownloadFormat/g)!.length).toBeGreaterThanOrEqual(3);
});
