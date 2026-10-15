const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { checkInjectedFunctions } = require('./check-injected-functions.cjs');
function audit(text) {
 const file = ts.createSourceFile('/fixture.ts', text, ts.ScriptTarget.ES2015, true);
 const host = ts.createCompilerHost({ noLib: true });
 host.getSourceFile = name => name === '/fixture.ts' ? file : undefined;
 const program = ts.createProgram(['/fixture.ts'], { noLib: true }, host);
 return checkInjectedFunctions(program);
}
test('rejects translation imports, module helpers and captured locals, including shorthand', () => {
 const result = audit(`import { t } from './ui-text';
 const label = 'video'; const helper = () => label;
 function read() { return { site: t(label), label, data: helper() }; }
 browser.scripting.executeScript({ func: read });`);
 assert.equal(result.checked, 1);
 assert.deepEqual(result.findings.map(f => /"(.*?)"/.exec(f.message)?.[1]), ['t', 'label', 'label', 'helper']);
});
test('accepts DOM globals, arguments, local helpers, property names and type-only imports', () => {
 const result = audit(`import type { Info } from './types';
 const title = 'outside';
 function read(title: string): Info {
  const local = () => document.title;
  return { title, length: local().length };
 }
 browser.scripting.executeScript({ func: read, args: [title] });`);
 assert.equal(result.checked, 1); assert.deepEqual(result.findings, []);
});
test('checks inline arrow closures and ES2015 async helper hazards', () => {
 const result = audit(`function send(value: string) {
  browser.scripting.executeScript({func: async () => value});
 }`);
 assert.equal(result.checked, 1); assert.equal(result.findings.length, 2);
});
test('does not silently count unresolved functions or file injection as safe function checks', () => {
 const result = audit(`browser.scripting.executeScript({func: makeReader()});
 browser.scripting.executeScript({files:['content.js']});`);
 assert.equal(result.checked, 0); assert.equal(result.findings.length, 1);
});
test('production-compiled Bilibili fetch runs after serialization without module helpers', async () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const source = ts.createSourceFile('background.ts', fs.readFileSync(path.join(__dirname, '../src/background.ts'), 'utf8'), ts.ScriptTarget.ES2015, true);
 let injected;
 const walk = n => {
  if (ts.isPropertyAssignment(n) && n.name.getText(source) === 'func' && n.initializer.getText(source).includes("Accept: 'application/json'")) injected = n.initializer.getText(source);
  ts.forEachChild(n, walk);
 };
 walk(source); assert.ok(injected, 'Bilibili page fetch must be exercised');
 const compiled = ts.transpile(`const fn = ${injected};`, { target: ts.ScriptTarget.ES2015 });
 const serialized = vm.runInNewContext(`${compiled}; fn.toString()`);
 const requests = [];
 const fn = vm.runInNewContext(`(${serialized})`, { fetch: (url, options) => { requests.push({url,options}); return Promise.resolve({ok:true,status:200,text:()=>Promise.resolve('{"body":[]}')}); } });
 assert.equal(JSON.stringify(await fn('https://api.bilibili.com/test')), JSON.stringify({ok:true,status:200,text:'{"body":[]}'}));
 assert.equal(requests[0].options.credentials, 'include');
});
