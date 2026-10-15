const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// No network or translation generation in a build. Missing translations fail closed.
execFileSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
 'src/i18n/catalog.test.ts', 'src/utils/ui-text.test.ts', 'src/utils/locale.test.ts',
 'src/utils/i18n.test.ts', 'src/utils/content-i18n.test.ts', 'src/utils/i18n-automation.test.ts', 'src/utils/recent-features-i18n.test.ts'], { cwd: root, stdio: 'inherit' });
