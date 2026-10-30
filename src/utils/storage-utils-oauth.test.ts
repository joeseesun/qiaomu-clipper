import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OAuthCredentials } from '../types/types';

// Each extension page (popup, settings, side panel, background) loads its own copy of these modules over one shared storage.
const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('./browser-polyfill', () => ({ default: { storage: { sync: {
	get: vi.fn(async (key: string | null) => key ? { [key]: structuredClone(store.data[key]) } : structuredClone(store.data)),
	set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store.data, structuredClone(items)); }),
	remove: vi.fn(async (keys: string[]) => { keys.forEach(key => delete store.data[key]); })
} } } }));
vi.mock('./debug', () => ({ debugLog: vi.fn() }));

type Page = { settings: typeof import('./storage-utils'); accounts: typeof import('./oauth/accounts') };
async function openPage(): Promise<Page> {
	vi.resetModules();
	const settings = await import('./storage-utils');
	const accounts = await import('./oauth/accounts');
	await settings.loadSettings();
	return { settings, accounts };
}
const signIn = (over: Partial<OAuthCredentials> = {}): OAuthCredentials => ({ kind: 'chatgpt', clientId: 'oaiapp_test', access: 'a1', refresh: 'r1', expires: 0, ...over });
const storedOAuth = () => (store.data.interpreter_settings as any).providers[0].oauth as OAuthCredentials | undefined;
const provider = (page: Page) => page.settings.generalSettings.providers[0];

afterEach(() => vi.unstubAllGlobals());
let spent: Set<string>;
let refreshes: string[];
beforeEach(() => {
	store.data = { migrationVersion: 1, interpreter_settings: { providers: [{ id: 'p', name: 'ChatGPT', baseUrl: '', apiKey: '', oauth: signIn() }], models: [] } };
	spent = new Set();
	refreshes = [];
	// A rotating refresh token: each one works once and is answered with the next.
	vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
		const token = new URLSearchParams(String(init.body)).get('refresh_token')!;
		refreshes.push(token);
		if (spent.has(token)) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
		spent.add(token);
		const n = Number(token.slice(1)) + 1;
		return new Response(JSON.stringify({ access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600 }));
	}));
});

it('does not write a stale refresh token back when another page saves an unrelated setting (#112)', async () => {
	const popup = await openPage();
	const olderSettingsPage = await openPage();
	await popup.accounts.freshOAuth(provider(popup), popup.settings.oauthStore);
	expect(storedOAuth()?.refresh).toBe('r2');

	await olderSettingsPage.settings.saveSettings({ showMoreActionsButton: true });
	expect(storedOAuth()?.refresh).toBe('r2');
	expect(provider(olderSettingsPage).oauth?.refresh).toBe('r2');
	expect((store.data.general_settings as any).showMoreActionsButton).toBe(true);

	const nextPopup = await openPage();
	expect((await nextPopup.accounts.freshOAuth(provider(nextPopup), nextPopup.settings.oauthStore)).refresh).toBe('r2');
	expect(refreshes).toEqual(['r1']);
});

it('a page that still holds the spent token takes the renewed one from storage instead of refreshing again', async () => {
	const a = await openPage();
	const b = await openPage();
	await a.accounts.freshOAuth(provider(a), a.settings.oauthStore);
	const renewed = await b.accounts.freshOAuth(provider(b), b.settings.oauthStore);
	expect(renewed.refresh).toBe('r2');
	expect(refreshes).toEqual(['r1']);
});

it('pages that refresh at the same time spend the refresh token once', async () => {
	// Web Locks are shared by every page of the extension, as Node's are by both module copies here.
	expect(navigator.locks).toBeDefined();
	const a = await openPage();
	const b = await openPage();
	const results = await Promise.all([a.accounts.freshOAuth(provider(a), a.settings.oauthStore), b.accounts.freshOAuth(provider(b), b.settings.oauthStore)]);
	expect(results.map(r => r.refresh)).toEqual(['r2', 'r2']);
	expect(refreshes).toEqual(['r1']);
	expect(storedOAuth()?.refresh).toBe('r2');
});

it('retries once with a token another page stored while this refresh was refused', async () => {
	const a = await openPage();
	// Another page spent r1 and stored r2 without this page knowing.
	spent.add('r1');
	store.data.interpreter_settings = { ...(store.data.interpreter_settings as object), providers: [{ id: 'p', name: 'ChatGPT', baseUrl: '', apiKey: '', oauth: signIn({ access: 'a2', refresh: 'r2', expires: 0 }) }] };
	const stale = { ...provider(a), oauth: signIn() };
	const load = vi.fn().mockResolvedValueOnce(signIn()).mockImplementation(a.settings.oauthStore.load);
	const renewed = await a.accounts.freshOAuth(stale, { load, save: a.settings.oauthStore.save });
	expect(renewed.refresh).toBe('r3');
	expect(storedOAuth()?.refresh).toBe('r3');
});

it('still writes sign-in changes made on this page', async () => {
	const page = await openPage();
	provider(page).oauth = signIn({ access: 'new-sign-in', refresh: 'fresh', expires: Date.now() + 3_600_000 });
	await page.settings.saveSettings();
	expect(storedOAuth()?.refresh).toBe('fresh');
	delete provider(page).oauth;
	await page.settings.saveSettings();
	expect(storedOAuth()).toBeUndefined();
});

it('a page that loaded before signing out does not bring the old sign-in back', async () => {
	const stale = await openPage();
	const settingsPage = await openPage();
	delete provider(settingsPage).oauth;
	await settingsPage.settings.saveSettings();
	await stale.settings.saveSettings({ showMoreActionsButton: true });
	expect(storedOAuth()).toBeUndefined();
	expect(provider(stale).oauth).toBeUndefined();
});

it('does not store renewed credentials for an account signed out meanwhile', async () => {
	const page = await openPage();
	(store.data.interpreter_settings as any).providers[0].oauth = undefined;
	const held = { ...provider(page), oauth: signIn({ refresh: 'r9' }) };
	await page.accounts.freshOAuth(held, { load: async () => undefined, save: page.settings.oauthStore.save });
	expect(storedOAuth()).toBeUndefined();
});
