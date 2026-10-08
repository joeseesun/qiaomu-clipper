import { expect, it } from 'vitest';
import { matchLocale } from './locale';
import { formatLocaleMessage } from './locale-message';
it.each([['zh-CN','zh_CN'],['zh-Hans-CN','zh_CN'],['zh-Hans-HK','zh_CN'],['zh-Hant-TW','zh_TW'],['zh-HK','zh_TW'],['zh','zh_CN'],['pt-BR','pt_BR'],['pt_BR','pt_BR'],['ja-JP','ja'],['ko-KR','ko'],['es-MX','es'],['de-DE','de'],['fr-CA','fr'],['ar-SA','en'],['zhunknown','en'],['pt-PT','pt_BR']])('matches %s to %s without losing scripts or regions', (code, want) => expect(matchLocale(code)).toBe(want));
it('keeps partial European Portuguese selectable when supplied by the legacy locale list', () => expect(matchLocale('pt-PT',['pt','pt_BR','en'])).toBe('pt'));
it('fills named and repeated numbered substitutions literally, including dollar signs in values', () => {
 expect(formatLocaleMessage({message:'$name$ / $name$ / $1',placeholders:{name:{content:'$1'}}},['Price $2'])).toBe('Price $2 / Price $2 / Price $2');
});
