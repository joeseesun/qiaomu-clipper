import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/utils/media-download-policy.test.ts', 'src/utils/download-button.test.ts', 'src/utils/browser-media-save.test.ts', 'src/utils/study-download.test.ts'], { stdio: 'inherit', env: { ...process.env, VITEST_EDITION: 'store' } });
process.exit(result.status ?? 1);
