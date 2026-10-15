import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { root, targets, outputDir } = require('./build-layout.cjs');
const { verifyBuild, digest } = require('./build-info.cjs');

const args = process.argv.slice(2);
let selected = targets;
let release = false;
while (args.length) {
	const arg = args.shift();
	if (arg === '--targets') selected = (args.shift() || '').split(',');
	else if (arg === '--release') release = true;
	else throw new Error(`Unknown option: ${arg}`);
}
if (!selected.length || new Set(selected).size !== selected.length || selected.some(t => !targets.includes(t))) throw new Error('Unknown or duplicate target');
execFileSync(process.execPath, [path.join(root, 'scripts/check-i18n.cjs')], { cwd: root, stdio: 'inherit' });
// Always check both Chrome editions before delivering either one.
if (selected.some(t => t.startsWith('chrome-'))) execFileSync(process.execPath, [path.join(root, 'scripts/check-editions.mjs')], { cwd: root, stdio: 'inherit' });
const infos = selected.map(target => verifyBuild(outputDir(target), { target }));
const first = infos[0];
if (infos.some(info => info.sourceHash !== first.sourceHash || info.commit !== first.commit || info.version !== first.version)) throw new Error('Builds do not share the same source');
if (release && infos.some(info => info.dirty)) throw new Error('Release requires committed source; use a candidate for local changes');
const buildId = `${first.commit.slice(0, 7)}-${first.sourceHash.slice(0, 12)}`;
const parent = path.join(root, 'releases', first.version);
fs.mkdirSync(parent, { recursive: true });
const destination = path.join(parent, buildId);
if (fs.existsSync(destination)) throw new Error(`Archive already exists; never overwrite it: ${destination}`);
const lock = destination + '.lock';
fs.mkdirSync(lock);
const temp = fs.mkdtempSync(path.join(parent, '.package-'));
try {
	const packages = [];
	for (const target of selected) {
		const name = `qiaomu-clipper-${first.version}-${target}.zip`;
		const file = path.join(temp, name);
		execFileSync('zip', ['-qr', '-X', file, '.'], { cwd: outputDir(target), stdio: 'inherit' });
		const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
		if (!entries.includes('manifest.json') || entries.length >= 400) throw new Error('Invalid package contents: ' + name);
		verifyBuild(outputDir(target), { target });
		packages.push({ target, file: name, sha256: digest(fs.readFileSync(file)) });
	}
	fs.writeFileSync(path.join(temp, 'SHA256SUMS'), packages.map(p => `${p.sha256}  ${p.file}\n`).join(''));
	fs.writeFileSync(path.join(temp, 'release.json'), JSON.stringify({ schema: 1, version: first.version, buildId, commit: first.commit, sourceHash: first.sourceHash, dirty: first.dirty, createdAt: new Date().toISOString(), status: release ? 'ready-for-review' : 'candidate', github: 'not-published', chromeWebStore: 'not-submitted', packages }, null, 2) + '\n');
	fs.renameSync(temp, destination);
	console.log(`Packages: ${destination}\nStatus: ${release ? 'ready for review' : 'candidate'}; not published or submitted.`);
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
	fs.rmdirSync(lock);
}
