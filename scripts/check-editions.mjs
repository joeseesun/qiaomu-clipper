// Run after building both editions: the store package must not carry the key, the local one must carry the key.
// Usage: node scripts/check-editions.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { outputDir } = createRequire(import.meta.url)('./build-layout.cjs');
const STORE = outputDir('chrome-store'), LOCAL = outputDir('chrome-local');
const STORE_ID = 'jniolfihillilkoajpnonlbkhfkiicoo';
const fail = message => { console.error('edition check failed: ' + message); process.exit(1); };
const manifest = dir => JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
const bundles = dir => readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'browser-polyfill.min.js').map(f => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
for (const dir of [STORE, LOCAL]) if (!existsSync(dir + '/manifest.json')) fail(`${dir} is not built`);
if (manifest(STORE).key) fail('the store package carries a key');
const key = manifest(LOCAL).key;
if (!key) fail('the local package has no key');
const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
if (id !== STORE_ID) fail(`the local key gives ${id}, not the store ID`);
for (const permission of ['downloads', 'cookies']) if ((manifest(STORE).permissions || []).includes(permission)) fail(`the store package asks for the "${permission}" permission at install (cookies may only be optional)`);
if (!(manifest(STORE).optional_permissions || []).includes('downloads')) fail('store media download must request downloads optionally');
if (!(manifest(STORE).optional_permissions || []).includes('cookies')) fail('the store package does not declare the optional cookies permission');
if (manifest(STORE).version !== manifest(LOCAL).version) fail('the two editions differ in version');
const store = bundles(STORE);
for (const marker of ['qiaomu-dl-style', 'googlevideo.com', 'youtube-nocookie.com']) if (!store.includes(marker)) fail('missing store media download policy: ' + marker);
console.log('editions ok: store uses optional downloads and a source policy; local has the store ID', id);
