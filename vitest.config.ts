import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Fixtures such as tests/fixtures expected-output carry a -08:00 timestamp; pin the zone so results don't depend on the machine.
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
	define: {
		DEBUG_MODE: false,
		__LOCAL_EDITION__: true,
	},
	test: {
		include: ['src/**/*.test.ts'],
		globals: true,
		setupFiles: ['src/utils/__setup__/zh.ts'],
		alias: {
			// fileURLToPath keeps this alias working on Windows, where URL.pathname is not a real path.
			'webextension-polyfill': fileURLToPath(new URL('./src/utils/__mocks__/webextension-polyfill.ts', import.meta.url)),
		},
	},
});
