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
		alias: {
			'webextension-polyfill': new URL('./src/utils/__mocks__/webextension-polyfill.ts', import.meta.url).pathname,
		},
	},
});
