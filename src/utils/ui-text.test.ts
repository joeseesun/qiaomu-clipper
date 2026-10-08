// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { localizeHelperReply, setUiLanguage, t, translateHelperText, translateStatic, uiLanguage } from './ui-text';

afterEach(() => setUiLanguage(undefined));

describe('t', () => {
	it('shows the Chinese as written for Simplified Chinese, and fills values', () => {
		setUiLanguage('zh_CN');
		expect(t('已保存到 {0}', ['笔记'])).toBe('已保存到 笔记');
	});
	it('translates to English and Traditional Chinese, and leaves unknown text alone', () => {
		setUiLanguage('en');
		expect(t('已保存到 {0}', ['Notes'])).toBe('Saved to Notes');
		expect(t('没有这条')).toBe('没有这条');
		setUiLanguage('zh_TW');
		expect(t('剪藏模版')).toBe('剪藏範本');
	});
	it('picks the language from codes the way browsers write them', () => {
		for (const [code, want] of [['zh-TW', 'zh_TW'], ['zh_HK', 'zh_TW'], ['zh-Hant', 'zh_TW'], ['zh-CN', 'zh_CN'], ['ja', 'ja'], ['de_DE', 'de'], ['pt-BR', 'pt_BR'], ['fr-CA', 'fr'], ['ar', 'en']] as const) { setUiLanguage(code); expect(uiLanguage()).toBe(want); }
	});
});

describe('static pages', () => {
	it('translates text, text with inline markup, and attributes', () => {
		setUiLanguage('en');
		document.body.innerHTML = '<div><label>语言</label><p>模版里写 <strong>{{"这篇文章的摘要"}}</strong> 这样的话，剪藏时由 AI 补上。需要先在「LLM 提供商与模型」里添加模型。</p><input placeholder="输入库名，按回车添加"></div>';
		translateStatic(document);
		expect(document.querySelector('label')!.textContent).toBe('Language');
		expect(document.querySelector('p')!.innerHTML).toContain('<strong>');
		expect(document.querySelector('p')!.textContent).toContain('Add a model first');
		expect(document.querySelector('input')!.placeholder).toBe('Type a vault name, then press Enter');
	});
});

describe('messages from the local helper', () => {
	it('translates a whole message, one with values, and one with a detail added', () => {
		setUiLanguage('en');
		expect(translateHelperText('笔记路径无效')).toBe('Invalid note path');
		expect(translateHelperText('正在下载识别模型（12 / 1300 MB）')).toBe('Downloading the recognition model (12 / 1300 MB)');
		expect(translateHelperText('音频下载失败：HTTP 403（Forbidden）')).toBe('Audio download failed: HTTP 403 (Forbidden)');
		expect(translateHelperText('report.pdf 是空文件')).toBe('report.pdf is empty');
	});
	it('leaves Simplified Chinese, codes and English alone', () => {
		setUiLanguage('zh_CN');
		expect(translateHelperText('笔记路径无效')).toBe('笔记路径无效');
		setUiLanguage('en');
		expect(translateHelperText('helper-offline')).toBe('helper-offline');
	});
	it('translates the message fields of a reply only', () => {
		setUiLanguage('en');
		expect(localizeHelperReply({ ok: false, error: '复制不完整', vault: '复制不完整', problems: ['复制不完整'] })).toEqual({ ok: false, error: 'The copy is incomplete', vault: '复制不完整', problems: ['The copy is incomplete'] });
	});
});

it.each(['ja','ko','es','fr','de','pt_BR'])('keeps model-download progress and error details intact in %s', locale => {
 setUiLanguage(locale);
 const progress = translateHelperText('正在下载识别模型（12 / 1300 MB）');
 expect(progress).toMatch(/12 \/ 1300 (?:MB|Mo)/);
 expect(progress).not.toContain('正在下载识别模型');
 expect(progress).not.toMatch(/^Downloading/);
 const error = translateHelperText('音频下载失败：HTTP 403（Forbidden）');
 expect(error).toContain('HTTP 403');
 expect(error).toContain('Forbidden');
 expect(error).not.toContain('音频下载失败');
 expect(error).not.toMatch(/^Audio download failed/);
});

describe('Windows helper recovery messages', () => {
 it.each(['en', 'zh_TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt_BR'])('localizes recovery progress and errors in %s', language => {
  setUiLanguage(language);
  const messages = ['正在不使用登录状态重试视频下载', '正在重试 YouTube 音频下载', 'YouTube 拒绝了当前登录状态，匿名下载也需要验证身份；请更新 YouTube 登录状态后重试', '字幕生成进程意外退出，请重试'];
  for (const message of messages) {
   const reply = localizeHelperReply({stage: message, error: message, errorCode: 'cookies-rejected'});
   expect(reply.stage).not.toBe(message);
   expect(reply.error).toBe(reply.stage);
   expect(reply.errorCode).toBe('cookies-rejected');
  }
 });
});
