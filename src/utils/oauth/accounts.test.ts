import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshOAuth, openRouterAuthUrl, oauthModelsRequest, responsesRequest, responsesText, startSignIn, type OAuthStore } from './accounts';
import { jwtClaims, openSignIn, pkcePair } from './core';

vi.mock('./core', async original => ({ ...await original<typeof import('./core')>(), openSignIn: vi.fn() }));
import type { ModelConfig, OAuthCredentials, Provider } from '../../types/types';

const jwt = (claims: object) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.y`;
const model = { providerModelId: 'gpt-x' } as ModelConfig;
const oauth = (over: Partial<OAuthCredentials> = {}): OAuthCredentials => ({ kind: 'codex', clientId: 'c', access: 'old', refresh: 'r1', expires: Date.now() + 3_600_000, accountId: 'acct', ...over });
const provider = (o: OAuthCredentials): Provider => ({ id: 'p', name: 'P', baseUrl: '', apiKey: '', oauth: o });
const lastSignInUrl = () => new URL(vi.mocked(openSignIn).mock.lastCall![0]);
const memory = (saved?: OAuthCredentials) => ({ load: vi.fn(async () => saved), save: vi.fn(async () => {}) }) satisfies OAuthStore;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('oauth accounts', () => {
	it('makes an S256 challenge that matches its verifier', async () => {
		const { verifier, challenge } = await pkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
		expect(challenge).toBe(btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
	});
	it('builds the OpenRouter sign-in address with a localhost return and a PKCE challenge', () => {
		const url = new URL(openRouterAuthUrl('http://localhost:50000/callback', 'chal', 'st'));
		expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
		expect(Object.fromEntries(url.searchParams)).toMatchObject({ callback_url: 'http://localhost:50000/callback', code_challenge: 'chal', code_challenge_method: 'S256', state: 'st' });
	});
	it('reads token claims', () => expect(jwtClaims(jwt({ email: 'a@b.c' })).email).toBe('a@b.c'));
	it('sends Codex requests to the ChatGPT backend with the account id', () => {
		const { url, init } = responsesRequest(oauth(), model, 'sys', [{ role: 'user', content: 'hi' }]);
		expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
		expect(init.headers).toMatchObject({ Authorization: 'Bearer old', 'chatgpt-account-id': 'acct' });
		expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-x', instructions: 'sys', store: false, stream: true, input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] });
	});
	it('sends ChatGPT sign-ins to the OpenAI API', () => {
		expect(responsesRequest(oauth({ kind: 'chatgpt' }), model, 's', []).url).toBe('https://api.openai.com/v1/responses');
		expect(oauthModelsRequest(oauth({ kind: 'chatgpt' })).url).toBe('https://api.openai.com/v1/models');
	});
	it('reads streamed text deltas only', () => {
		expect(responsesText('data: {"type":"response.output_text.delta","delta":"Hi"}')).toBe('Hi');
		expect(responsesText('data: {"type":"response.completed"}')).toBe('');
		expect(responsesText('event: x')).toBe('');
	});
	it('keeps a token that is not about to expire', async () => {
		expect((await freshOAuth(provider(oauth()), memory())).access).toBe('old');
		expect(fetch).not.toHaveBeenCalled();
	});
	it('renews an expiring token, keeps the account and saves the rotated tokens', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 })));
		const p = provider(oauth({ expires: Date.now() + 1000 }));
		const store = memory();
		const next = await freshOAuth(p, store);
		expect(next).toMatchObject({ access: 'new', refresh: 'r2', accountId: 'acct', clientId: 'c' });
		expect(p.oauth).toBe(next);
		expect(store.save).toHaveBeenCalledExactlyOnceWith('p', next);
	});
	it('asks to sign in again when the refresh token is refused, keeping the cause', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
		await expect(freshOAuth(provider(oauth({ expires: 0 })), memory())).rejects.toMatchObject({ message: expect.stringContaining('重新登录'), code: 'invalid_grant', status: 400 });
	});
	it('does not send a rejected app registration down the sign-in-again path', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }));
		const error = await freshOAuth(provider(oauth({ kind: 'chatgpt', expires: 0 })), memory()).catch(e => e);
		expect(error).toMatchObject({ code: 'invalid_client', status: 401 });
		expect(error.message).toContain('invalid_client');
		expect(error.message).not.toContain('重新登录');
	});
	it('keeps temporary server failures apart from an expired sign-in', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('busy', { status: 503 }));
		const error = await freshOAuth(provider(oauth({ expires: 0 })), memory()).catch(e => e);
		expect(error.status).toBe(503);
		expect(error.message).not.toContain('重新登录');
	});
	it('uses a sign-in another page already renewed instead of spending the token again', async () => {
		const renewed = oauth({ access: 'other', refresh: 'r2', expires: Date.now() + 3_600_000 });
		const store = memory(renewed);
		expect(await freshOAuth(provider(oauth({ expires: 0 })), store)).toBe(renewed);
		expect(fetch).not.toHaveBeenCalled();
		expect(store.save).not.toHaveBeenCalled();
	});
	it('registers a new app on the first ChatGPT sign-in', async () => {
		vi.mocked(openSignIn).mockReturnValue({ result: new Promise(() => {}), submitUrl: () => false, cancel: () => {} });
		await startSignIn('chatgpt');
		const url = lastSignInUrl();
		expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
		expect(url.searchParams.get('agent_name_hint')).toBe('qiaomu-clipper');
		expect(url.searchParams.has('id_token_hint')).toBe(false);
	});
	it('signs in again with the saved registration and account instead of registering another app', async () => {
		const idToken = jwt({ sub: 'user-1', email: 'a@b.c' });
		let back!: (url: URL) => void;
		vi.mocked(openSignIn).mockReturnValue({ result: new Promise(r => { back = r; }), submitUrl: () => false, cancel: () => {} });
		const pending = await startSignIn('chatgpt', oauth({ kind: 'chatgpt', clientId: 'oaiapp_1', idToken, email: 'a@b.c' }));
		const url = lastSignInUrl();
		expect(url.searchParams.get('client_id')).toBe('oaiapp_1');
		expect(url.searchParams.has('agent_name_hint')).toBe(false);
		expect(url.searchParams.get('id_token_hint')).toBe(idToken);
		expect(url.searchParams.get('login_hint')).toBe('a@b.c');
		expect(url.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/);

		// The callback may leave out client_id; the saved one is used for the exchange.
		const nonce = url.searchParams.get('nonce');
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'openid chatgpt.tokens.use.direct', id_token: jwt({ iss: 'https://auth.openai.com', aud: 'oaiapp_1', nonce, sub: 'user-1', email: 'a@b.c' }) })));
		back(new URL(`http://127.0.0.1:1455/auth/callback?code=c&state=${url.searchParams.get('state')}`));
		const result = await pending.finish();
		expect(result.oauth).toMatchObject({ clientId: 'oaiapp_1', refresh: 'r' });
		expect(new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]!.body)).get('client_id')).toBe('oaiapp_1');
	});
	it('refuses a reauthorization that comes back for another account or app', async () => {
		const idToken = jwt({ sub: 'user-1' });
		for (const [callbackClient, sub] of [['oaiapp_other', 'user-1'], ['', 'user-2']]) {
			let back!: (url: URL) => void;
			vi.mocked(openSignIn).mockReturnValue({ result: new Promise(r => { back = r; }), submitUrl: () => false, cancel: () => {} });
			const pending = await startSignIn('chatgpt', oauth({ kind: 'chatgpt', clientId: 'oaiapp_1', idToken }));
			const url = lastSignInUrl();
			vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'chatgpt.tokens.use.direct', id_token: jwt({ iss: 'https://auth.openai.com', aud: 'oaiapp_1', nonce: url.searchParams.get('nonce'), sub }) })));
			back(new URL(`http://127.0.0.1:1455/auth/callback?code=c&state=${url.searchParams.get('state')}${callbackClient ? `&client_id=${callbackClient}` : ''}`));
			await expect(pending.finish()).rejects.toThrow('校验未通过');
		}
	});
});
