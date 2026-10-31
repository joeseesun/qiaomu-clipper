// Build a reproducible, isolated verification page. Source logic is unchanged;
// only database/lock/channel names are prefixed and chrome.storage is mocked.
const fs = require('node:fs'), path = require('node:path');
const root = process.env.SOURCE_ROOT || path.resolve(__dirname, '../../../..'), output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute directory outside the source tree');
const esbuild = require(path.join(root, 'node_modules/esbuild')), sass = require(path.join(root, 'node_modules/sass'));
fs.mkdirSync(output, { recursive: true });
esbuild.build({ entryPoints: [path.join(__dirname, 'fixture.ts')], bundle: true, outfile: path.join(output, 'fixture.js'), format: 'iife', plugins: [{ name: 'isolated-history', setup(build) {
 build.onResolve({ filter: /browser-polyfill$/ }, () => ({ path: path.join(__dirname, 'browser-mock.ts') }));
 build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/\.\.\/src\// }, args => ({ path: path.join(root, args.path.replace('../../../../', '') + '.ts') }));
 build.onLoad({ filter: /chat-history-(store|media|events)\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replaceAll('qiaomu-chat-', 'qiaomu-cleanup-verification-chat-'), loader: 'ts' }));
} }] }).catch(error => { console.error(error); process.exitCode = 1; });
fs.writeFileSync(path.join(output, 'fixture.css'), sass.compileString(`@import '${root}/src/styles/variables'; @import '${root}/src/styles/clip-chat';`, { loadPaths: [path.join(root, 'src/styles')], logger: sass.Logger.silent }).css);
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(output, 'index.html'));
