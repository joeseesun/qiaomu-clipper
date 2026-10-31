const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readDelivery(root) {
	const scope = JSON.parse(fs.readFileSync(path.join(root, 'test-delivery.json'), 'utf8'));
	if (scope.schema !== 1 || !Array.isArray(scope.features)) throw new Error('Invalid test delivery scope');
	const ids = new Set();
	for (const feature of scope.features) {
		if (!/^[a-z][a-z0-9-]+$/.test(feature.id) || ids.has(feature.id) || typeof feature.title !== 'string' || !feature.title.trim()
			|| !Array.isArray(feature.files) || !feature.files.length || !Array.isArray(feature.tests) || !feature.tests.length) throw new Error('Invalid or duplicate delivery feature');
		ids.add(feature.id);
		for (const file of [...feature.files, ...feature.tests]) {
			if (typeof file !== 'string' || !/^(src|native|scripts)\/[a-zA-Z0-9_./-]+$/.test(file) || file.split('/').includes('..')
				|| !fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile()) throw new Error(`Missing delivery source: ${file}`);
		}
		if (feature.tests.some(file => !/^src\/.+\.test\.ts$/.test(file) && !/^native\/test_[a-zA-Z0-9_]+\.py$/.test(file))) throw new Error('Delivery checks must name regression test files');
	}
	return scope;
}

function assertCoverage(scope, previous) {
	const ids = new Set(scope.features.map(feature => feature.id));
	const missing = (previous?.features || []).filter(feature => !ids.has(feature.id));
	if (missing.length) throw new Error(`Refusing to remove tested features: ${missing.map(feature => feature.title).join(', ')}`);
}

// An older checkout can pass its own tests while removing newer installed fixes.
function assertBuildBase(root, candidate, installed) {
 if (!installed) return;
 const versionParts = version => String(version).split('.').map(Number);
 const next = versionParts(candidate.version), previous = versionParts(installed.version);
 for (let i = 0; i < Math.max(next.length, previous.length); i++) {
  const difference = (next[i] || 0) - (previous[i] || 0);
  if (difference < 0) throw new Error(`Refusing to downgrade fixed test install: ${installed.version} -> ${candidate.version}`);
  if (difference > 0) break;
 }
 if (!/^[a-f0-9]{40}$/.test(installed.commit || '') || !/^[a-f0-9]{40}$/.test(candidate.commit || '')) throw new Error('Missing test build commit identity');
 try { execFileSync('git', ['merge-base', '--is-ancestor', installed.commit, candidate.commit], { cwd: root, stdio: 'pipe' }); }
 catch { throw new Error(`Test build must include installed commit ${installed.commit}; integrate current test changes before delivery`); }
}

function runDeliveryTests(root, scope) {
	if (scope.features.some(feature => feature.id === 'douyin-study-source')) execFileSync(process.execPath, [path.join(root, 'scripts/check-injected-functions.cjs')], { cwd: root, stdio: 'inherit' });
	if (scope.features.some(feature => feature.id === 'store-media-download')) execFileSync(process.execPath, [path.join(root, 'scripts/test-store-download.mjs')], { cwd: root, stdio: 'inherit' });
	const tests = [...new Set(scope.features.flatMap(feature => feature.tests))];
	const browserTests = tests.filter(file => file.startsWith('src/'));
	const nativeTests = tests.filter(file => file.startsWith('native/')).map(file => path.basename(file, '.py'));
	if (browserTests.length) execFileSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...browserTests], { cwd: root, stdio: 'inherit' });
	if (nativeTests.length) execFileSync(process.env.QIAOMU_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-X', 'utf8', '-m', 'unittest', ...nativeTests], { cwd: path.join(root, 'native'), stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
	return { ...scope, checkedAt: new Date().toISOString() };
}

module.exports = { readDelivery, assertCoverage, assertBuildBase, runDeliveryTests };
