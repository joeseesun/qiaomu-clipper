// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_LOCALES } from '../utils/locale';
import { pageStrings, sourceStrings } from './collect';

const all = new Map([...pageStrings(), ...sourceStrings()]);
const read = (file: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8')) as Record<string, string>;
const english = read('ui-en.json'), helperEnglish = read('helper-en.json');
const messagesEnglish = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../_locales/en/messages.json'), 'utf8')) as Record<string, {message:string;placeholders?:Record<string, unknown>}>;
const holes = (value: string) => (value.match(/\{\{[a-z_][a-z0-9_]*\}\}|\{(?:\d+|[a-z_][a-z0-9_]*)\}|\$\d+|\$[a-z_][a-z0-9_]*\$/gi) || []).sort();
if (process.env.I18N_DUMP) fs.writeFileSync(path.resolve(process.env.I18N_DUMP), JSON.stringify([...all.keys()].filter(key => !(key in english)), null, 1));

describe.each(FULL_LOCALES.filter(locale => locale !== 'zh_CN'))('complete %s catalogs', locale => {
 const ui = read(`ui-${locale}.json`), helper = read(`helper-${locale}.json`);
 const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../_locales/${locale}/messages.json`), 'utf8')) as typeof messagesEnglish;
 it('covers every active interface string', () => expect([...all].filter(([key]) => !ui[key]?.trim()).map(([key, file]) => `${file}: ${key}`)).toEqual([]));
 it('covers helper text and extension message keys without empty translations', () => {
  expect(Object.keys(helperEnglish).filter(key => !helper[key]?.trim())).toEqual([]);
  expect(Object.keys(messagesEnglish).filter(key => !messages[key]?.message?.trim() && messagesEnglish[key].message.trim())).toEqual([]);
 });
 it('preserves repeated runtime placeholders and named placeholder definitions', () => {
  expect([...all.keys()].filter(key => ui[key] && JSON.stringify(holes(ui[key])) !== JSON.stringify(holes(key)))).toEqual([]);
  expect(Object.keys(helperEnglish).filter(key => helper[key] && JSON.stringify(holes(helper[key])) !== JSON.stringify(holes(key)))).toEqual([]);
  expect(Object.keys(messagesEnglish).filter(key => messages[key] && (JSON.stringify(holes(messages[key].message)) !== JSON.stringify(holes(messagesEnglish[key].message)) || JSON.stringify(messages[key].placeholders) !== JSON.stringify(messagesEnglish[key].placeholders)))).toEqual([]);
 });
 it('keeps links, markup structure and installer command paths intact', () => {
  const tags = (s: string) => (s.match(/<\/?[a-z][^>]*>/gi) || []);
  const links = (s: string) => (s.match(/https?:\/\/[^\s<>"，。；）]+/g) || []).map(url => url.replace(/[.,;:)]+$/, '')).sort();
  const paths = (s: string) => (s.match(/\/Library\/QiaomuClipper\/[a-zA-Z0-9_./-]+|python3 native\/install\.py|qiaomu-clipper-helper\.pkg|--extension-id|--check/g) || []).sort();
  expect(Object.keys(english).filter(key => ui[key] && (JSON.stringify(tags(ui[key])) !== JSON.stringify(tags(english[key])) || JSON.stringify(links(ui[key])) !== JSON.stringify(links(english[key])) || JSON.stringify(paths(ui[key])) !== JSON.stringify(paths(english[key]))))).toEqual([]);
 });
});

// Long English sentences copied into another catalog are fallback text, not completed translations.
// Genuine identical technical examples/brand names stay unchanged; reviewed exceptions need a reason.
describe.each(FULL_LOCALES.filter(locale => locale !== 'en'))('translation review %s', locale => {
 it('does not mark English sentences or recent provider controls as translated', () => {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../_locales/${locale}/messages.json`), 'utf8')) as typeof messagesEnglish;
  const controls = ['pdGroupPlan', 'pdDetectMagpie', 'pdEffort', 'pdEffortDefault'];
  const untranslated = Object.keys(messagesEnglish).filter(key => {
   const source = messagesEnglish[key].message;
   return messages[key]?.message === source && ((source.length >= 20 && source.includes(' ')) || controls.includes(key));
  });
  expect(untranslated).toEqual([]);
  if (locale !== 'zh_CN') {
   const ui = read(`ui-${locale}.json`), helper = read(`helper-${locale}.json`);
   // These are unchanged product names, not prose copied as a translation.
   const brands = new Set(['阿里云百炼', '豆包语音（火山引擎）']);
   for (const [source, translated] of [[english, ui], [helperEnglish, helper]]) {
    expect(Object.keys(source).filter(key => !brands.has(key) && source[key].length >= 20 && source[key].includes(' ') && translated[key] === source[key])).toEqual([]);
   }
  }
 });
});
