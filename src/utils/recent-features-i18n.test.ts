// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FULL_LOCALES } from './locale';
import { localeMessage } from './locale-message';
import { localizeHelperReply, setUiLanguage, t } from './ui-text';
import { reasoningEffortOption } from './reasoning-label';
import { CATALOG } from './provider-catalog';

const identifiers = CATALOG.map(({ id, baseUrl }) => ({ id, baseUrl }));
afterEach(() => setUiLanguage(undefined));

describe.each(FULL_LOCALES)('recent feature wording in %s', locale => {
 it('localizes model controls and keeps provider and option values stable', () => {
  setUiLanguage(locale);
  const title = localeMessage(locale, 'pdEffortDefault');
  expect(title).toBeTruthy();
  if (locale !== 'en') expect(title).not.toBe(localeMessage('en', 'pdEffortDefault'));
  const select = document.createElement('select');
  const values = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'vendor_level'];
  for (const value of values) select.append(reasoningEffortOption(value));
  expect(Array.from(select.options).map(option => option.value)).toEqual(values);
  if (locale !== 'en') expect(select.options[2].text).not.toBe('Low');
  expect(select.options[8].text).toBe('vendor_level');
  expect(CATALOG.map(({ id, baseUrl }) => ({ id, baseUrl }))).toEqual(identifiers);
  const plan = CATALOG.find(provider => provider.id === 'kimi-code')!;
  expect(plan.name).toContain('Kimi Code');
  if (!locale.startsWith('zh')) expect(plan.name).not.toContain('国内套餐');
 });
 it('translates recent image, download and replay messages without changing codes or source addresses', () => {
  setUiLanguage(locale);
  for (const source of ['正在读取图片…', '未获得下载权限，请再次点击下载并允许。', '仅下载你有权保存的内容']) {
   if (locale !== 'zh_CN') expect(t(source)).not.toBe(source);
  }
  const reply = localizeHelperReply({ error: '回放下载失败，请重新读取原链接后重试', errorCode: 'media-expired', url: 'https://example.test/回放', stage: '回放片段读取超时' });
  expect(reply.errorCode).toBe('media-expired');
  expect(reply.url).toBe('https://example.test/回放');
  if (locale !== 'zh_CN') {
   expect(reply.error).not.toBe('回放下载失败，请重新读取原链接后重试');
   expect(reply.stage).not.toBe('回放片段读取超时');
  }
 });
});
