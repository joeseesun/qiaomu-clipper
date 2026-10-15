import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { root, outputDir } = require('./build-layout.cjs');
const { verifyBuild, writeBuildInfo } = require('./build-info.cjs');
const { readDelivery, assertCoverage, assertBuildBase, runDeliveryTests } = require('./test-delivery.cjs');
const { checkDevelopmentBase } = require('./check-development-base.cjs');

const args = process.argv.slice(2);
let edition = 'store';
let testRoot = process.env.QIAOMU_TEST_HOME || path.join(os.homedir(), 'Documents', '乔木剪藏测试');
while (args.length) {
	const arg = args.shift();
	if (arg === '--edition') edition = args.shift();
	else if (arg === '--root') testRoot = args.shift();
	else throw new Error(`Unknown option: ${arg}`);
}
if (!['store', 'local'].includes(edition)) throw new Error('Edition must be store or local');
if (!testRoot || !path.isAbsolute(testRoot) || path.resolve(testRoot) === path.parse(testRoot).root || path.resolve(testRoot) === os.homedir()) throw new Error('Choose a dedicated absolute testing folder');
checkDevelopmentBase(root, testRoot);
execFileSync(process.execPath, [path.join(root, 'scripts/check-i18n.cjs')], { cwd: root, stdio: 'inherit' });
const source = outputDir(`chrome-${edition}`);
const info = verifyBuild(source, { target: `chrome-${edition}` });
if (fs.existsSync(testRoot) && fs.lstatSync(testRoot).isSymbolicLink()) throw new Error('Testing folder must not be a symlink');
fs.mkdirSync(testRoot, { recursive: true });
const owner = path.join(testRoot, '.qiaomu-testing.json');
if (!fs.existsSync(owner)) {
	if (fs.readdirSync(testRoot).length) throw new Error('Existing folder is not managed by Qiaomu test preparation');
	fs.writeFileSync(owner, JSON.stringify({ schema: 1, kind: 'qiaomu-clipper-testing' }), { flag: 'wx' });
}
if (JSON.parse(fs.readFileSync(owner, 'utf8')).kind !== 'qiaomu-clipper-testing') throw new Error('Invalid testing folder marker');
const lock = path.join(testRoot, '.prepare-lock');
fs.mkdirSync(lock); // An explicit preparation cannot race another worktree.
const stage = fs.mkdtempSync(path.join(testRoot, '.staging-'));
const destination = path.join(testRoot, 'extension');
const previous = path.join(testRoot, 'previous');
let movedPrevious = false;
try {
	for (const existing of [destination, previous]) {
		if (!fs.existsSync(existing)) continue;
		if (fs.lstatSync(existing).isSymbolicLink()) throw new Error('Test install must not be a symlink');
		const old = JSON.parse(fs.readFileSync(path.join(existing, 'build-info.json'), 'utf8'));
		if (!old.testInstall) throw new Error('Refusing to replace an unmanaged extension');
	}
	const scope = readDelivery(root);
	const installedInfo = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(path.join(destination, 'build-info.json'), 'utf8')) : null;
	assertBuildBase(root, info, installedInfo);
	assertCoverage(scope, installedInfo?.delivery);
	const delivery = runDeliveryTests(root, scope);
	fs.cpSync(source, stage, { recursive: true });
	verifyBuild(stage, { target: `chrome-${edition}` });
	const manifestFile = path.join(stage, 'manifest.json');
	const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
	manifest.key = fs.readFileSync(path.join(root, 'scripts/chrome-local-key.txt'), 'utf8').trim();
	manifest.name = `乔木剪藏 · ${edition === 'store' ? '商店版' : '独立版'}测试`;
	manifest.version_name = `${info.version} · ${edition} TEST · ${info.commit.slice(0, 7)}-${info.sourceHash.slice(0, 8)}${info.dirty ? '-dirty' : ''}`;
	fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, '\t') + '\n');
	writeBuildInfo(stage, { ...info, testInstall: true, delivery, preparedAt: new Date().toISOString() });
	fs.rmSync(previous, { recursive: true, force: true });
	if (fs.existsSync(destination)) { fs.renameSync(destination, previous); movedPrevious = true; }
	try { fs.renameSync(stage, destination); }
	catch (error) { if (movedPrevious) fs.renameSync(previous, destination); throw error; }
	fs.writeFileSync(path.join(testRoot, 'CURRENT.json'), JSON.stringify({ edition, version: info.version, commit: info.commit, sourceHash: info.sourceHash, dirty: info.dirty, sourceWorktree: root, extension: destination, delivery, preparedAt: new Date().toISOString() }, null, 2) + '\n');
	fs.writeFileSync(path.join(testRoot, '安装测试.md'), `# 乔木剪藏测试\n\n固定加载目录：${destination}\n\n当前：${edition === 'store' ? '商店版' : '独立版'}测试 ${info.version}，构建 ${info.commit.slice(0, 7)}-${info.sourceHash.slice(0, 8)}${info.dirty ? '（含未提交修改）' : ''}。\n\n仅在专用测试浏览器资料中加载此目录，避免替换日常商店版。之后始终使用同一路径，在扩展管理页重新加载，再刷新原网页并重新打开阅读页。\n\n商店版测试并非商店已上架版本。本地助手由各资料共享，需另行验证。上一份测试扩展保留在 previous/。\n`);
	console.log(`Ready: ${destination}\n${manifest.name} ${manifest.version_name}\nReload the extension in the dedicated test profile, then reopen its pages.`);
	fs.appendFileSync(path.join(testRoot, '安装测试.md'), `\n## 本包功能清单\n\n${delivery.features.map(feature => `- ${feature.title}`).join('\n')}\n\n以上功能对应的自动回归检查已通过；不代表已完成本次浏览器重载或真实模型调用。\n`);
} finally {
	fs.rmSync(stage, { recursive: true, force: true });
	fs.rmdirSync(lock);
}
