const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const webpack = require('webpack');
const { pageSharedChunks, ExtensionPageScriptsPlugin } = require('./extension-page-chunks.cjs');

test('compiled pages load shared dependencies while content scripts and workers start alone', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-page-chunks-'));
 const message = '简体繁體日本語한국어🙂'.repeat(4000);
 try {
  fs.writeFileSync(path.join(root, 'shared.js'), `export const message = ${JSON.stringify(message)};`);
  for (const name of ['popup', 'settings', 'content', 'background']) fs.writeFileSync(path.join(root, `${name}.js`), "import {message} from './shared'; globalThis.result = message;");
  const compiler = webpack({
   mode: 'production', context: root,
   entry: Object.fromEntries(['popup', 'settings', 'content', 'background'].map(name => [name, `./${name}.js`])),
   output: { path: path.join(root, 'out'), filename: '[name].js', publicPath: '' },
   optimization: { splitChunks: pageSharedChunks(), minimize: false },
   plugins: [new ExtensionPageScriptsPlugin(), { apply(compiler) {
    compiler.hooks.thisCompilation.tap('FixtureHtml', compilation => {
     compilation.hooks.processAssets.tap({ name: 'FixtureHtml', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
      compilation.emitAsset('popup.html', new webpack.sources.RawSource('<script type="module" src="popup.js"></script>'));
      compilation.emitAsset('settings.html', new webpack.sources.RawSource('<script src="settings.js"></script>'));
     });
    });
   } }],
  });
  const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  const out = path.join(root, 'out');
  for (const name of ['popup', 'settings']) {
   const html = fs.readFileSync(path.join(out, `${name}.html`), 'utf8');
   const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map(match => match[1]);
   assert.deepEqual(scripts, stats.compilation.entrypoints.get(name).getFiles());
   assert.ok(scripts.length > 1);
   assert.equal(scripts.at(-1), `${name}.js`);
   const sandbox = { self: {} }; vm.createContext(sandbox);
   for (const file of scripts) vm.runInContext(fs.readFileSync(path.join(out, file), 'utf8'), sandbox);
   assert.equal(sandbox.result, message);
  }
  for (const name of ['content', 'background']) {
   assert.deepEqual(stats.compilation.entrypoints.get(name).getFiles(), [`${name}.js`]);
   const sandbox = { self: {} }; vm.createContext(sandbox);
   vm.runInContext(fs.readFileSync(path.join(out, `${name}.js`), 'utf8'), sandbox);
   assert.equal(sandbox.result, message);
  }
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
