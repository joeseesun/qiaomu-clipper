import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshOAuth, oauthModelsRequest, responsesRequest, responsesText } from './accounts';
import { jwtClaims, pkcePair } from './core';
import type { ModelConfig, OAuthCredentials, Provider } from '../../types/types';

const jwt = (claims: object) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.y`;
const model = { providerModelId: 'gpt-x' } as ModelConfig;
const oauth = (over: Partial<OAuthCredentials> = {}): OAuthCredentials => ({ kind: 'codex', clientId: 'c', access: 'old', refresh: 'r1', expires: Date.now() + 3_600_000, accountId: 'acct', ...over });
const provider = (o: OAuthCredentials): Provider => ({ id: 'p', name: 'P', baseUrl: '', apiKey: '', oauth: o });

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('oauth accounts', () => {
	it('makes an S256 challenge that matches its verifier', async () => {
		const { verifier, challenge } = await pkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
		expect(challenge).toBe(btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
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
		const save = vi.fn();
		expect((await freshOAuth(provider(oauth()), save)).access).toBe('old');
		expect(fetch).not.toHaveBeenCalled();
	});
	it('renews an expiring token, keeps the account and saves the rotated tokens', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 })));
		const p = provider(oauth({ expires: Date.now() + 1000 }));
		const save = vi.fn();
		const next = await freshOAuth(p, save);
		expect(next).toMatchObject({ access: 'new', refresh: 'r2', accountId: 'acct', clientId: 'c' });
		expect(p.oauth).toBe(next);
		expect(save).toHaveBeenCalledOnce();
	});
	it('asks to sign in again when the refresh token is refused', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
		await expect(freshOAuth(provider(oauth({ expires: 0 })), vi.fn())).rejects.toThrow('重新登录');
	});
});
