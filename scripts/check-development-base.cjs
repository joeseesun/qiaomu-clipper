const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function checkDevelopmentBase(root, testRoot = path.join(os.homedir(), 'Documents', '乔木剪藏测试')) {
 const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
 const commit = git('rev-parse', 'HEAD');
 const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
 let latest;
 try { latest = git('rev-parse', '--verify', 'refs/remotes/origin/main'); } catch { /* isolated fixtures may have no remote */ }
 if (latest) {
  try { git('merge-base', '--is-ancestor', latest, commit); }
  catch { throw new Error(`Development checkout ${commit.slice(0, 7)} (${version}) does not include origin/main ${latest.slice(0, 7)}. Preserve local changes and integrate on the latest mainline before starting.`); }
 }
 const installedFile = path.join(testRoot, 'extension/build-info.json');
 if (fs.existsSync(installedFile)) {
  const installed = JSON.parse(fs.readFileSync(installedFile, 'utf8'));
  const previous = String(installed.version).split('.').map(Number), next = String(version).split('.').map(Number);
  for (let i = 0; i < Math.max(previous.length, next.length); i++) {
   const difference = (next[i] || 0) - (previous[i] || 0);
   if (difference < 0) throw new Error(`Development version ${version} is older than fixed test install ${installed.version}.`);
   if (difference > 0) break;
  }
  if (!/^[a-f0-9]{40}$/.test(installed.commit || '')) throw new Error('Missing installed test commit identity');
  try { git('merge-base', '--is-ancestor', installed.commit, commit); }
  catch { throw new Error(`Development checkout must include fixed test commit ${installed.commit}. Integrate installed changes first.`); }
  // A dirty candidate can contain functionality not committed to mainline yet.
  // Read CURRENT.json and reconcile its delivery scope; ancestry alone cannot prove it is retained.
 }
 return { version, commit, latest: latest || null, testRoot };
}
if (require.main === module) {
 try { console.log(JSON.stringify(checkDevelopmentBase(path.resolve(__dirname, '..')), null, 2)); }
 catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkDevelopmentBase };
