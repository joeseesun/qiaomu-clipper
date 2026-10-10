// Optional production-bundle acceptance test. Uses an isolated Edge profile and a fake Native Messaging host: no API calls or real user configuration.
// Build first: npm run build:local. Run with Playwright available, or set QIAOMU_PLAYWRIGHT to its installed module path.
const { chromium } = require(process.env.QIAOMU_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = process.env.QIAOMU_TEST_OUTPUT || path.join(os.tmpdir(), 'qiaomu-local-study-test');
fs.mkdirSync(output, { recursive: true });
const KEY = 'file:' + 'a'.repeat(32), TOKEN = 'b'.repeat(24);
// A valid, harmless 12-second WAV, so native playback can be exercised without any private media.
const wav = Buffer.alloc(44 + 16000 * 12 * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let n = 0; n < 16000 * 12; n++) wav.writeInt16LE(Math.round(3000 * Math.sin(n * 2 * Math.PI * 440 / 16000)), 44 + n * 2);

(async () => {
 const extension = path.resolve(process.env.QIAOMU_TEST_DIST || path.join(root, 'dist_local'));
 const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output, 'profile-')), {
  executablePath: process.env.QIAOMU_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1280, height: 900 },
 });
 const checks = [], errors = [];
 const page = await context.newPage();
 page.on('pageerror', error => errors.push(error.message));
 try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname, url = `chrome-extension://${id}/reader.html?study=file&token=${TOKEN}`;
  // All native requests are intercepted in the production background worker, including uploads and status. API keys are dummy and never logged.
  await worker.evaluate(({ KEY }) => {
   globalThis.fixture = { starts: 0, uploads: 0, calls: [], text: '第一份完整字幕', running: false, failUpload: false, failJob: false, failChoice: false };
   chrome.runtime.sendNativeMessage = (_host, message, callback) => {
    const f = globalThis.fixture; f.calls.push(message.action); let reply;
    switch (message.action) {
     case 'asrStatus': reply = { ok: true, ready: true, missing: [], hints: [], engine: message.cloud ? 'cloud' : null, modelDownloadNeeded: false, local: [{ id: 'faster-whisper', name: 'Whisper', supported: true, installed: false, managed: true, sizeMb: 1700 }], installable: { base: false, engines: ['faster-whisper'] } }; break;
     case 'asrUploadStart': f.uploads++; reply = f.failUpload ? { ok: false, error: 'no-space' } : { ok: true, uploadId: 'c'.repeat(32) }; break;
     case 'asrUploadChunk': reply = { ok: true }; break;
     case 'asrUploadFinish': reply = { ok: true, key: KEY }; break;
     case 'asrStart':
      f.starts++; f.force = message.force === true;
      reply = { ok: true, id: 'd'.repeat(32), videoKey: KEY, engine: 'cloud', state: f.failJob ? 'failed' : f.running ? 'transcribing' : 'completed', error: f.failJob ? 'fixture cloud failure' : null, progress: f.running ? 10 : 100, stage: '', segments: [{ start: 0, end: 3, text: f.text }], next: 1 }; break;
     case 'asrPoll': reply = { ok: true, id: 'd'.repeat(32), videoKey: KEY, state: f.failJob ? 'failed' : f.running ? 'transcribing' : 'completed', error: f.failJob ? 'fixture cloud failure' : null, progress: f.running ? 10 : 100, stage: '', segments: message.since === 0 ? [{ start: 0, end: 3, text: f.text }] : [], next: 1 }; break;
     default: reply = { ok: true };
    }
    if (callback) callback(reply); else return Promise.resolve(reply);
   };
   return chrome.storage.local.set({ language: 'zh_CN', qiaomuAsrSettings: { mode: 'cloud', engine: 'faster-whisper', active: 'sf', autoStart: true, useContext: false, profiles: [
    { id: 'sf', provider: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B', apiKey: 'fixture-only', protocol: 'openai-transcriptions' },
    { id: 'glm', provider: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-asr-2512', apiKey: 'fixture-only', protocol: 'openai-transcriptions' },
   ] } });
  }, { KEY });
  await page.goto(`chrome-extension://${id}/reader.html?study=file`);
  if (process.env.QIAOMU_TEST_BASELINE) {
   await page.locator('.qiaomu-audio-chooser').waitFor();
   assert.equal(await page.locator('.qiaomu-file-recognizer').count(), 0);
   await page.screenshot({ path: path.join(output, 'upstream-before-file.png') });
   await page.evaluate(async ({ TOKEN, bytes }) => {
    const db = await new Promise(resolve => { const r=indexedDB.open('qiaomu-handoff',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'token'});r.onsuccess=()=>resolve(r.result); });
    await new Promise(resolve => { const tx=db.transaction('files','readwrite');tx.objectStore('files').put({token:TOKEN,file:new File([new Uint8Array(bytes)],'lecture.wav',{type:'audio/wav'}),at:Date.now()});tx.oncomplete=resolve; });db.close();
   }, { TOKEN, bytes:[...wav] });
   await page.goto(url); await page.locator('.transcript').waitFor();
   await page.locator('.qiaomu-yt-gen[data-kind=generated] button').click();
   await worker.evaluate(() => { globalThis.fixture.text='上游重新生成的字幕'; });
   await page.locator('.qiaomu-dlg-btn.is-primary').click();
   await page.locator('.qiaomu-audio-chooser').waitFor();
   assert.equal(await page.locator('.transcript').count(),0);assert.equal(await page.locator('video').count(),0);
   await page.screenshot({path:path.join(output,'upstream-after-regenerate-blank.png')});
   console.log(JSON.stringify({baseline:'reproduced',missingModelPicker:true,remakeLostPlayerAndCaptions:true}));
   return;
  }
  await page.locator('.qiaomu-file-recognizer select').waitFor();
  await page.waitForFunction(() => document.querySelector('.qiaomu-file-recognizer')?.textContent.includes('Qwen/Qwen3-ASR-1.7B'));
  assert.match(await page.locator('.qiaomu-file-recognizer').innerText(), /Qwen\/Qwen3-ASR-1\.7B/); checks.push('provider/model visible before file');
  await page.screenshot({ path: path.join(output, 'before-file.png') });
  // Real IndexedDB with the production handoff schema. Exercise cross-page token read and committed deletion.
  await page.evaluate(async ({ TOKEN, bytes }) => {
   const db = await new Promise((resolve, reject) => { const r = indexedDB.open('qiaomu-handoff', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'token' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
   await new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ token: TOKEN, file: new File([new Uint8Array(bytes)], 'lecture.wav', { type: 'audio/wav' }), at: Date.now() }); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  }, { TOKEN, bytes: [...wav] });
  await page.goto(url);
  await page.locator('.qiaomu-dlg-wrap').waitFor();
  assert.equal(await worker.evaluate(() => globalThis.fixture.starts), 0); checks.push('auto-start held for explicit cloud confirmation');
  assert.equal(await page.evaluate(async TOKEN => { const r = indexedDB.open('qiaomu-handoff', 1); const db = await new Promise(resolve => r.onsuccess = () => resolve(r.result)); const q = db.transaction('files').objectStore('files').get(TOKEN); const value = await new Promise(resolve => q.onsuccess = () => resolve(q.result)); db.close(); return value === undefined; }, TOKEN), true); checks.push('token acknowledged after upload');
  await page.locator('.qiaomu-dlg-btn.is-primary').click();
  await page.locator('.transcript-segment').filter({ hasText: '第一份完整字幕' }).waitFor();
  await page.locator('video').evaluate(video => { globalThis.savedPlayer = video; video.currentTime = 4; video.playbackRate = 1.5; });
  await page.locator('.qiaomu-yt-gen[data-kind=generated] button').click();
  await page.locator('.qiaomu-dlg-choice[data-value="cloud:glm"]').click();
  await page.waitForFunction(() => document.querySelector('.qiaomu-dlg-choice[data-value="cloud:glm"]')?.getAttribute('aria-checked') === 'true');
  await worker.evaluate(() => { globalThis.fixture.text = '更换模型后的完整字幕'; });
  await page.locator('.qiaomu-dlg-btn.is-primary').click();
  await page.locator('.transcript-segment').filter({ hasText: '更换模型后的完整字幕' }).waitFor();
  assert.equal(await page.locator('.transcript').count(), 1);
  assert.deepEqual(await page.locator('video').evaluate(video => ({ same: video === globalThis.savedPlayer, time: video.currentTime, rate: video.playbackRate })), { same: true, time: 4, rate: 1.5 });
  assert.equal(await page.locator('.player-toggle-group').count(), 1);
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')).pending === false);
  assert.doesNotMatch(await page.locator('.qiaomu-audio-status').innerText(), /未保存/);
  assert.match(await page.locator('.qiaomu-file-recognizer').innerText(), /glm-asr-2512/);
  checks.push('in-place replacement preserves player/time/rate and one controls group');
  await page.screenshot({ path: path.join(output, 'after-regenerate.png') });
  await page.reload();
  await page.locator('.transcript-segment').filter({ hasText: '更换模型后的完整字幕' }).waitFor();
  assert.equal(await page.title(), 'lecture'); assert.equal(await page.locator('video').count(), 0);
  assert.match(await page.locator('.qiaomu-audio-chooser').innerText(), /重新选择同一文件/);
  const starts = await worker.evaluate(() => globalThis.fixture.starts);
  await page.locator('input[type=file]').setInputFiles({ name: 'lecture.wav', mimeType: 'audio/wav', buffer: wav });
  await page.locator('video').waitFor({ state: 'attached' });
  await page.locator('.transcript-segment').filter({ hasText: '更换模型后的完整字幕' }).waitFor();
  assert.equal(await worker.evaluate(() => globalThis.fixture.starts), starts); checks.push('refresh recovers cache/title; same-file reselect restores player without recognition');
  // In-flight remakes keep the old complete transcript; refresh only polls the saved task ID.
  await worker.evaluate(() => { globalThis.fixture.running = true; globalThis.fixture.text = '后台完成字幕'; });
  await page.locator('.qiaomu-yt-gen[data-kind=generated] button').click(); await page.locator('.qiaomu-dlg-btn.is-primary').click();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')).pending === true);
  const pendingStarts = await worker.evaluate(() => globalThis.fixture.starts);
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')).jobId === 'd'.repeat(32));
  await worker.evaluate(() => { globalThis.fixture.running = false; });
  await page.reload(); await page.locator('.transcript-segment').filter({ hasText: '后台完成字幕' }).waitFor();
  assert.equal(await worker.evaluate(() => globalThis.fixture.starts), pendingStarts); checks.push('refresh polls original task without any new recognition');
  await worker.evaluate(() => { globalThis.fixture.running = true; });
  await page.locator('.qiaomu-yt-gen[data-kind=generated] button').click(); await page.locator('.qiaomu-dlg-btn.is-primary').click();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')).pending && JSON.parse(sessionStorage.getItem('qiaomuFileStudySession')).jobId);
  const failedStarts = await worker.evaluate(() => globalThis.fixture.starts);
  await worker.evaluate(() => { globalThis.fixture.running = false; globalThis.fixture.failJob = true; });
  await page.reload(); await page.locator('.qiaomu-yt-gen[data-kind=failed]').waitFor();
  assert.equal(await worker.evaluate(() => globalThis.fixture.starts), failedStarts);
  await page.locator('.qiaomu-yt-gen[data-kind=failed] button').first().click(); await page.locator('.qiaomu-dlg-wrap').waitFor();
  assert.equal(await worker.evaluate(() => globalThis.fixture.starts), failedStarts);
  checks.push('background failure stays failed after refresh; retry requires confirmation');
  await worker.evaluate(() => { globalThis.fixture.failJob = false; });
  // Upload errors stay visible and do not consume the handoff.
  const failure = await context.newPage(); failure.on('pageerror', error => errors.push(error.message));
  await worker.evaluate(() => { globalThis.fixture.failUpload = true; });
  await failure.goto(`chrome-extension://${id}/reader.html?study=file`);
  await failure.locator('input[type=file]').setInputFiles({ name: 'retry.wav', mimeType: 'audio/wav', buffer: wav });
  await failure.locator('.qiaomu-audio-status').filter({ hasText: '磁盘空间不足' }).waitFor();
  await worker.evaluate(() => { globalThis.fixture.failUpload = false; });
  await failure.locator('.qiaomu-audio-chooser button').filter({ hasText: '重试' }).click();
  await failure.locator('.transcript').waitFor(); checks.push('upload failure visible and retry restores cached success');
  // A failed remake does not overwrite the previous successful cache.
  await worker.evaluate(() => { globalThis.fixture.failJob = true; });
  await failure.locator('.qiaomu-yt-gen[data-kind=generated] button').click(); await failure.locator('.qiaomu-dlg-btn.is-primary').click();
  await failure.locator('.qiaomu-yt-gen[data-kind=failed]').waitFor();
  assert.match(await failure.locator('.transcript').innerText(), /后台完成字幕/); checks.push('failed remake retains complete result');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'edge-results.json'), JSON.stringify({ checks, pageErrors: errors, helper: 'mocked; no paid API calls', edge: context.browser()?.version() }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, helper: 'mocked; no paid API calls' }));
 } catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  fs.writeFileSync(path.join(output, 'edge-failure.json'), JSON.stringify({ error: error.message, checks, pageErrors: errors }, null, 2));
  throw error;
 } finally { await context.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
