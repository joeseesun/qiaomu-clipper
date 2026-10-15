const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root } = require('./build-layout.cjs');

const digest = value => createHash('sha256').update(value).digest('hex');
function assertVersion(version) {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.split('.').some(n => Number(n) > 65535) || version === '0.0.0') throw new Error('Version must have three integers from 0 to 65535, without leading zeros, and not all zero');
	return version;
}
function sourceState(cwd = root) {
	const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
	const files = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].sort();
	const hash = createHash('sha256');
	for (const file of files) {
		const full = path.join(cwd, file);
		hash.update(file + '\0');
		if (!fs.existsSync(full)) { hash.update('deleted\0'); continue; }
		const stat = fs.lstatSync(full);
		hash.update(String(stat.mode & 0o777) + '\0');
		hash.update(stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full));
		hash.update('\0');
	}
	return { commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')), sourceHash: hash.digest('hex') };
}
function fileHashes(dir) {
	const result = {};
	function walk(base, relative = '') {
		for (const name of fs.readdirSync(base).sort()) {
			const full = path.join(base, name), rel = relative + name;
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) throw new Error(`Symlink in build: ${rel}`);
			if (stat.isDirectory()) walk(full, rel + '/');
			else if (rel !== 'build-info.json') result[rel] = digest(fs.readFileSync(full));
		}
	}
	walk(dir);
	return result;
}
function writeBuildInfo(dir, info) {
	fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({ ...info, files: fileHashes(dir) }, null, 2) + '\n');
}
function verifyBuild(dir, { target, current = true, cwd = root } = {}) {
	const info = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'));
	const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
	assertVersion(info.version);
	if (info.schema !== 1 || info.mode !== 'production' || info.testInstall || (target && info.target !== target)) throw new Error('Expected a production build for ' + target);
	if (manifest.version !== info.version) throw new Error('Manifest and build version differ');
	if (JSON.stringify(fileHashes(dir)) !== JSON.stringify(info.files)) throw new Error('Build files changed: rebuild before packaging or testing');
	if (current) {
		if (info.version !== JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version) throw new Error('Package version changed: rebuild');
		const state = sourceState(cwd);
		if (state.commit !== info.commit || state.sourceHash !== info.sourceHash || state.dirty !== info.dirty) throw new Error('Source changed since build: rebuild before packaging or testing');
	}
	return info;
}
module.exports = { assertVersion, digest, sourceState, fileHashes, writeBuildInfo, verifyBuild };
