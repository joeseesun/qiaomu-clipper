import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { root } = require('./build-layout.cjs');
const { assertVersion } = require('./build-info.cjs');
const version = assertVersion(process.argv[2] || '');
for (const file of ['package.json', 'package-lock.json']) {
	const target = path.join(root, file);
	const data = JSON.parse(fs.readFileSync(target, 'utf8'));
	data.version = version;
	if (data.packages?.['']) data.packages[''].version = version;
	fs.writeFileSync(target, JSON.stringify(data, null, '\t') + '\n');
}
const project = path.join(root, 'xcode/Obsidian Web Clipper/Obsidian Web Clipper.xcodeproj/project.pbxproj');
const source = fs.readFileSync(project, 'utf8');
const builds = [...source.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map(match => Number(match[1]));
if (!builds.length) throw new Error('Xcode build number missing');
fs.writeFileSync(project, source.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`).replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${Math.max(...builds) + 1};`));
console.log(`Extension version: ${version}. Rebuild before testing or packaging. Helper version unchanged.`);
