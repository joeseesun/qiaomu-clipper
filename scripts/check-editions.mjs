// Run after building both editions: the store package must not carry the key or any local-only code, the local one must carry the key.
// Usage: node scripts/check-editions.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const STORE_ID = 'jniolfihillilkoajpnonlbkhfkiicoo';
const LOCAL_ONLY = ['qiaomuDownloadChoice', 'qiaomu-dl-style', 'qiaomu-dl-menu'];   // names that only the local edition's code uses
const fail = message => { console.error('edition check failed: ' + message); process.exit(1); };
const manifest = dir => JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
const bundles = dir => readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'browser-polyfill.min.js').map(f => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
for (const dir of ['dist', 'dist_local']) if (!existsSync(dir + '/manifest.json')) fail(`${dir} is not built`);
if (manifest('dist').key) fail('the store package carries a key');
const key = manifest('dist_local').key;
if (!key) fail('the local package has no key');
const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
if (id !== STORE_ID) fail(`the local key gives ${id}, not the store ID`);
for (const permission of ['downloads', 'cookies']) if ((manifest('dist').permissions || []).includes(permission)) fail(`the store package asks for the "${permission}" permission at install (cookies may only be optional)`);
if (!(manifest('dist').optional_permissions || []).includes('cookies')) fail('the store package does not declare the optional cookies permission');
if (manifest('dist').version !== manifest('dist_local').version) fail('the two editions differ in version');
const store = bundles('dist'), local = bundles('dist_local');
for (const name of LOCAL_ONLY) {
	if (store.includes(name)) fail(`"${name}" is in the store bundle`);
	if (!local.includes(name)) console.warn(`note: "${name}" is not in the local bundle (feature not built yet?)`);
}
console.log('editions ok: store has no key or local-only code; local has the store ID', id);
