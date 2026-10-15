const path = require('node:path');

const root = path.resolve(__dirname, '..');
const targets = ['chrome-store', 'chrome-local', 'firefox', 'safari'];
function outputDir(target, mode = 'production') {
	if (!targets.includes(target) || !['production', 'development'].includes(mode)) throw new Error('Unknown build target or mode');
	return path.join(root, 'build', mode === 'production' ? 'production' : 'dev', target);
}
module.exports = { root, targets, outputDir };
