const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertVersion, sourceState, writeBuildInfo, verifyBuild } = require('./build-info.cjs');

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-build-test-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, 'scripts'));
	for (const file of ['build-layout.cjs', 'build-info.cjs', 'test-delivery.cjs', 'prepare-test.mjs', 'package.mjs', 'check-editions.mjs', 'chrome-local-key.txt', 'check-development-base.cjs']) fs.copyFileSync(path.join(__dirname, file), path.join(root, 'scripts', file));
	fs.writeFileSync(path.join(root, 'scripts/check-i18n.cjs'), `if (require('node:fs').existsSync(require('node:path').join(__dirname, '../i18n-fails'))) throw new Error('Missing translation fixture');`);
	fs.writeFileSync(path.join(root, 'test-delivery.json'), JSON.stringify({ schema: 1, features: [] }));
	fs.writeFileSync(path.join(root, '.gitignore'), 'build/\nreleases/\ntesting/\nnode_modules\n');
	fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.17.0"}\n');
	const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
	git('init'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
	const key = fs.readFileSync(path.join(root, 'scripts/chrome-local-key.txt'), 'utf8').trim();
	function build() {
		const state = sourceState(root);
		for (const target of ['chrome-store', 'chrome-local']) {
			const dir = path.join(root, 'build/production', target);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Fixture', version: '1.17.0', permissions: target === 'chrome-local' ? ['downloads', 'cookies'] : [], ...(target === 'chrome-local' ? { key } : { optional_permissions: ['cookies', 'downloads'] }) }));
			fs.writeFileSync(path.join(dir, 'content.js'), target === 'chrome-local' ? 'qiaomuDownloadChoice qiaomu-dl-style qiaomu-dl-menu' : 'store payload qiaomu-dl-style googlevideo.com youtube-nocookie.com');
			writeBuildInfo(dir, { schema: 1, target, mode: 'production', version: '1.17.0', ...state });
		}
	}
	build();
	const run = (script, ...args) => execFileSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: os.tmpdir(), encoding: 'utf8', stdio: 'pipe' });
	return { root, build, run, store: path.join(root, 'build/production/chrome-store'), home: path.join(root, 'testing') };
}

test('rejects stale source and changed production bytes', t => {
	const f = fixture(t);
	assert.equal(verifyBuild(f.store, { cwd: f.root }).version, '1.17.0');
	fs.writeFileSync(path.join(f.store, 'content.js'), 'changed');
	assert.throws(() => verifyBuild(f.store, { cwd: f.root }), /Build files changed/);
	f.build();
	fs.writeFileSync(path.join(f.root, 'new-source.ts'), 'new source');
	assert.throws(() => verifyBuild(f.store, { cwd: f.root }), /Source changed/);
});

test('one fixed test path switches editions, retains previous, leaves production unchanged', t => {
	const f = fixture(t);
	const original = fs.readFileSync(path.join(f.store, 'manifest.json'), 'utf8');
	f.run('prepare-test.mjs', '--root', f.home);
	const destination = path.join(f.home, 'extension');
	let manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json')));
	assert.match(manifest.name, /商店版测试/);
	assert.ok(manifest.key);
	assert.deepEqual(manifest.permissions, []);
	assert.equal(fs.readFileSync(path.join(destination, 'content.js'), 'utf8'), 'store payload qiaomu-dl-style googlevideo.com youtube-nocookie.com');
	assert.equal(fs.readFileSync(path.join(f.store, 'manifest.json'), 'utf8'), original);
	f.run('prepare-test.mjs', '--root', f.home, '--edition', 'local');
	manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json')));
	assert.match(manifest.name, /独立版测试/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'previous/build-info.json'))).target, 'chrome-store');
	fs.mkdirSync(path.join(f.home, '.prepare-lock'));
	assert.throws(() => f.run('prepare-test.mjs', '--root', f.home));
	assert.match(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'))).name, /独立版测试/);
});

test('does not replace arbitrary folders or deliver stale builds', t => {
	const f = fixture(t);
	fs.mkdirSync(f.home); fs.writeFileSync(path.join(f.home, 'keep.txt'), 'user data');
	assert.throws(() => f.run('prepare-test.mjs', '--root', f.home));
	assert.equal(fs.readFileSync(path.join(f.home, 'keep.txt'), 'utf8'), 'user data');
	fs.writeFileSync(path.join(f.root, 'new-source.ts'), 'new source');
	assert.throws(() => f.run('prepare-test.mjs', '--root', f.home + '-fresh'));
	assert.equal(fs.existsSync(f.home + '-fresh'), false);
});

test('packages from any cwd, seals checksums, refuses overwrite and dirty releases', t => {
	const f = fixture(t);
	f.run('package.mjs', '--targets', 'chrome-store,chrome-local');
	const parent = path.join(f.root, 'releases/1.17.0');
	const destination = path.join(parent, fs.readdirSync(parent)[0]);
	const record = JSON.parse(fs.readFileSync(path.join(destination, 'release.json')));
	assert.equal(record.status, 'candidate');
	assert.equal(record.chromeWebStore, 'not-submitted');
	assert.equal(record.packages.length, 2);
	for (const item of record.packages) {
		const bytes = fs.readFileSync(path.join(destination, item.file));
		assert.equal(require('./build-info.cjs').digest(bytes), item.sha256);
	}
	assert.throws(() => f.run('package.mjs', '--targets', 'chrome-store,chrome-local'), /Archive already exists/);
	fs.writeFileSync(path.join(f.root, 'change.ts'), 'dirty'); f.build();
	assert.throws(() => f.run('package.mjs', '--targets', 'chrome-store,chrome-local', '--release'), /committed source/);
});


test('rejects invalid Chrome versions before emitting packages', () => {
 for (const version of ['1.02.3', '0.0.0', '1.2.65536', '1.2.3-rc1', '../escape']) assert.throws(() => assertVersion(version));
 assert.equal(assertVersion('1.17.0'), '1.17.0');
});

test('a shared dependency symlink does not change source identity', t => {
	const f = fixture(t);
	const before = sourceState(f.root);
	fs.symlinkSync(path.join(f.root, 'scripts'), path.join(f.root, 'node_modules'), 'junction');
	assert.deepEqual(sourceState(f.root), before);
});

test('cannot mark a dirty build clean by editing its metadata', t => {
	const f = fixture(t);
	fs.writeFileSync(path.join(f.root, 'change.ts'), 'uncommitted'); f.build();
	const file = path.join(f.store, 'build-info.json');
	const info = JSON.parse(fs.readFileSync(file)); info.dirty = false;
	fs.writeFileSync(file, JSON.stringify(info));
	assert.throws(() => verifyBuild(f.store, { cwd: f.root }), /Source changed/);
});

test('refuses another worktree build that drops an installed feature', t => {
	const f = fixture(t);
	f.run('prepare-test.mjs', '--root', f.home);
	const file = path.join(f.home, 'extension/build-info.json');
	const installed = JSON.parse(fs.readFileSync(file));
	installed.delivery.features.push({ id: 'article-image-chat', title: 'AI 读图' });
	fs.writeFileSync(file, JSON.stringify(installed));
	const before = fs.readFileSync(file, 'utf8');
	assert.throws(() => f.run('prepare-test.mjs', '--root', f.home), /Refusing to remove tested features/);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
	assert.equal(fs.existsSync(path.join(f.home, '.prepare-lock')), false);
});

test('missing feature source or failing regression checks leave the installed build intact', t => {
	const f = fixture(t);
	f.run('prepare-test.mjs', '--root', f.home);
	const installed = path.join(f.home, 'extension/build-info.json');
	const before = fs.readFileSync(installed, 'utf8');
	const feature = { id: 'article-image-chat', title: 'AI 读图', files: ['src/chat.ts'], tests: ['src/chat.test.ts'] };
	fs.writeFileSync(path.join(f.root, 'test-delivery.json'), JSON.stringify({ schema: 1, features: [feature] }));
	f.build();
	assert.throws(() => f.run('prepare-test.mjs', '--root', f.home), /Missing delivery source/);
	fs.mkdirSync(path.join(f.root, 'src'));
	fs.writeFileSync(path.join(f.root, 'src/chat.ts'), 'fixture');
	fs.writeFileSync(path.join(f.root, 'src/chat.test.ts'), 'fixture');
	// A failing test runner must stop before renaming any installed files.
	fs.mkdirSync(path.join(f.root, 'node_modules/vitest'), { recursive: true });
	fs.writeFileSync(path.join(f.root, 'node_modules/vitest/vitest.mjs'), 'process.exit(1)');
	f.build();
	assert.throws(() => f.run('prepare-test.mjs', '--root', f.home));
	assert.equal(fs.readFileSync(installed, 'utf8'), before);
});

// A failed language gate must not produce a deliverable or replace a working test install.
test('translation failure blocks packaging and preserves the fixed test installation', t => {
 const f=fixture(t); f.run('prepare-test.mjs','--root',f.home);
 const before=fs.readFileSync(path.join(f.home,'extension/manifest.json'),'utf8');
 fs.writeFileSync(path.join(f.root,'i18n-fails'),'missing'); f.build();
 assert.throws(()=>f.run('prepare-test.mjs','--root',f.home), /Missing translation fixture/);
 assert.equal(fs.readFileSync(path.join(f.home,'extension/manifest.json'),'utf8'),before);
 assert.throws(()=>f.run('package.mjs','--targets','chrome-store'), /Missing translation fixture/);
 assert.equal(fs.existsSync(path.join(f.root,'releases')),false);
});


test('refuses an older version even when its own build and scope are valid', t => {
 const f = fixture(t); f.run('prepare-test.mjs', '--root', f.home);
 const file = path.join(f.home, 'extension/build-info.json');
 const installed = JSON.parse(fs.readFileSync(file)); installed.version = '1.18.1';
 fs.writeFileSync(file, JSON.stringify(installed));
 const before = fs.readFileSync(file, 'utf8');
 assert.throws(() => f.run('prepare-test.mjs', '--root', f.home), /older than fixed test install|Refusing to downgrade/);
 assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('refuses the same version from a checkout missing installed commits', t => {
 const f = fixture(t);
 const git = (...args) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
 const base = git('rev-parse', 'HEAD').toString().trim();
 fs.writeFileSync(path.join(f.root, 'new-fix.ts'), 'later fix');
 git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'later fix');
 f.build(); f.run('prepare-test.mjs', '--root', f.home);
 const file = path.join(f.home, 'extension/build-info.json'); const before = fs.readFileSync(file, 'utf8');
 git('checkout', '--detach', base); f.build();
 assert.throws(() => f.run('prepare-test.mjs', '--root', f.home), /must include (fixed test|installed) commit/);
 assert.equal(fs.readFileSync(file, 'utf8'), before);
});


test('development preflight rejects a stale checkout and accepts its latest mainline', t => {
 const f = fixture(t);
 const { checkDevelopmentBase } = require('./check-development-base.cjs');
 const git = (...args) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
 const base = git('rev-parse', 'HEAD').toString().trim();
 fs.writeFileSync(path.join(f.root, 'new-fix.ts'), 'later fix'); git('add', '.');
 git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'later fix');
 const latest = git('rev-parse', 'HEAD').toString().trim(); git('update-ref', 'refs/remotes/origin/main', latest);
 assert.equal(checkDevelopmentBase(f.root, f.home).commit, latest);
 git('checkout', '--detach', base);
 assert.throws(() => checkDevelopmentBase(f.root, f.home), /does not include origin\/main/);
});
