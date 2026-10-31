// Builds only the public browser fixture; never changes extension data or builds.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../..'), output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute output directory outside the source tree');
fs.mkdirSync(output, { recursive: true });
const esbuild = require(path.join(root, 'node_modules/esbuild')), sass = require(path.join(root, 'node_modules/sass'));
esbuild.build({ entryPoints: [path.join(__dirname, 'fixture.ts')], bundle: true, outfile: path.join(output, 'fixture.js'), format: 'iife', define: { DEBUG_MODE: 'false', __LOCAL_EDITION__: 'false' }, plugins: [{ name: 'public-fixture-browser', setup(build) { build.onResolve({ filter: /browser-polyfill$/ }, () => ({ path: path.join(__dirname, 'browser-mock.ts') })); } }] }).catch(error => { console.error(error); process.exitCode = 1; });
fs.writeFileSync(path.join(output, 'fixture.css'), sass.compileString(`@import '${root}/src/styles/variables'; @import '${root}/src/styles/clip-chat';`, { loadPaths: [path.join(root, 'src/styles')], logger: sass.Logger.silent }).css);
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(output, 'index.html'));
