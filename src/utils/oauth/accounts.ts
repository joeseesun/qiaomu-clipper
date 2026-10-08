import type { ModelConfig, OAuthCredentials, Provider } from '../../types/types';
import { jwtClaims, openSignIn, pkcePair, randomString, SignInHandle } from './core';

import { t } from '../ui-text';
export type OAuthKind = NonNullable<OAuthCredentials['kind']>;

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTHORIZE = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN = 'https://auth.openai.com/oauth/token';
const CODEX_REDIRECT = 'http://localhost:1455/auth/callback';
const CODEX_SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
export const CODEX_BASE = 'https://chatgpt.com/backend-api/codex';
const CODEX_VERSION = '0.159.0';

const SIWC_AUTHORIZE = 'https://auth.openai.com/api/accounts/authorize';
const SIWC_TOKEN = 'https://auth.openai.com/api/accounts/oauth/token';
const SIWC_ISSUER = 'https://auth.openai.com';
const SIWC_RESOURCE = 'https://api.openai.com/v1';
const SIWC_DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SIWC_SCOPES = `openid profile email offline_access resource.invoke ${SIWC_DIRECT_SCOPE}`;
export const CHATGPT_BASE = 'https://api.openai.com/v1';
const SIWC_REDIRECT = 'http://127.0.0.1:1455/auth/callback';
const SIWC_HOST_KEY = 'qiaomu-chatgpt-host-id';

const TOKENDANCE_AUTH = 'https://tokendance.space/auth';
const TOKENDANCE_EXCHANGE = 'https://tokendance.space/portal/api/v1/auth/keys';
const OPENROUTER_AUTH = 'https://openrouter.ai/auth';
const OPENROUTER_EXCHANGE = 'https://openrouter.ai/api/v1/auth/keys';
const APP_URL = 'https://github.com/joeseesun/qiaomu-clipper';

const MARGIN_MS = 3 * 60 * 1000;

export interface PendingSignIn { handle: SignInHandle; finish(): Promise<{ apiKey?: string; oauth?: OAuthCredentials; label: string }> }

function hostId(): string {
	try {
		const saved = localStorage.getItem(SIWC_HOST_KEY);
		if (saved?.startsWith('urn:uuid:')) return saved;
		const id = `urn:uuid:${crypto.randomUUID()}`;
		localStorage.setItem(SIWC_HOST_KEY, id);
		return id;
	} catch { return `urn:uuid:${crypto.randomUUID()}`; }
}

async function postToken(url: string, body: string | Record<string, string>, label: string): Promise<any> {
	const json = typeof body !== 'string';
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: json ? JSON.stringify(body) : body,
		credentials: 'omit'
	});
	const text = await response.text();
	let data: any = {};
	try { data = JSON.parse(text); } catch { /* keep text for the message */ }
	if (!response.ok) {
		const reason = data.error_description || data.error?.message || (typeof data.error === 'string' ? data.error : '') || text.slice(0, 160);
		throw Object.assign(new Error(t('{0}失败（{1}）{2}', [label, response.status, reason ? '：' + reason : ''])), { code: typeof data.error === 'string' ? data.error : data.error?.code, status: response.status });
	}
	return data;
}

function creds(kind: OAuthKind, tok: any, base: Partial<OAuthCredentials>): OAuthCredentials {
	const id = jwtClaims(tok.id_token);
	const auth = id['https://api.openai.com/auth'] || {};
	const access = jwtClaims(tok.access_token)['https://api.openai.com/auth'] || {};
	const lifetime = Number(tok.expires_in) || (jwtClaims(tok.access_token).exp ? jwtClaims(tok.access_token).exp - Date.now() / 1000 : 3600);
	return {
		...base,
		clientId: base.clientId || '',
		kind,
		access: tok.access_token,
		refresh: tok.refresh_token || base.refresh || '',
		idToken: tok.id_token || base.idToken,
		expires: Date.now() + lifetime * 1000,
		accountId: auth.chatgpt_account_id || access.chatgpt_account_id || base.accountId,
		email: id.email || base.email,
		plan: auth.chatgpt_plan_type || access.chatgpt_plan_type || base.plan
	};
}

// OpenRouter accepts any localhost port for the return address, and answers the code with an ordinary API key.
export function openRouterAuthUrl(redirect: string, challenge: string, state: string): string {
	return `${OPENROUTER_AUTH}?${new URLSearchParams({ callback_url: redirect, code_challenge: challenge, code_challenge_method: 'S256', key_label: 'Qiaomu Clipper', state })}`;
}

export async function startSignIn(kind: 'tokendance' | 'openrouter' | OAuthKind): Promise<PendingSignIn> {
	const { verifier, challenge } = await pkcePair();
	const state = randomString(32);
	if (kind === 'codex') {
		const url = `${CODEX_AUTHORIZE}?${new URLSearchParams({ response_type: 'code', client_id: CODEX_CLIENT_ID, redirect_uri: CODEX_REDIRECT, scope: CODEX_SCOPES, code_challenge: challenge, code_challenge_method: 'S256', id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', state, originator: 'codex_cli_rs' })}`;
		const handle = openSignIn(url, CODEX_REDIRECT);
		return { handle, async finish() {
			const back = await handle.result;
			if (back.searchParams.get('state') !== state) throw new Error(t('登录结果与本次请求不符，请重试'));
			const code = back.searchParams.get('code');
			if (!code) throw new Error(back.searchParams.get('error_description') || t('登录没有完成'));
			const tok = await postToken(CODEX_TOKEN, new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CODEX_REDIRECT, client_id: CODEX_CLIENT_ID, code_verifier: verifier }).toString(), t('登录 Codex'));
			if (!tok.access_token || !tok.refresh_token) throw new Error(t('Codex 没有返回登录凭证'));
			const oauth = creds('codex', tok, { clientId: CODEX_CLIENT_ID });
			return { oauth, label: oauth.email || 'Codex' };
		} };
	}
	if (kind === 'chatgpt') {
		const nonce = randomString(24);
		const host = hostId();
		const url = `${SIWC_AUTHORIZE}?${new URLSearchParams({ client_id: 'dynamic_agent_client', agent_name_hint: 'qiaomu-clipper', ext_agent_host_id: host, response_type: 'code', redirect_uri: SIWC_REDIRECT, resource: SIWC_RESOURCE, scope: SIWC_SCOPES, state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })}`;
		const handle = openSignIn(url, SIWC_REDIRECT);
		return { handle, async finish() {
			const back = await handle.result;
			if (back.searchParams.get('state') !== state) throw new Error(t('登录结果与本次请求不符，请重试'));
			const code = back.searchParams.get('code');
			const clientId = (back.searchParams.get('client_id') || '').trim();
			if (!code) throw new Error(back.searchParams.get('error_description') || t('登录没有完成'));
			if (!clientId) throw new Error(t('OpenAI 没有完成应用注册，请重试'));
			const tok = await postToken(SIWC_TOKEN, new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: SIWC_REDIRECT, resource: SIWC_RESOURCE }).toString(), t('登录 ChatGPT'));
			if (!tok.access_token || !tok.refresh_token || !tok.id_token) throw new Error(t('OpenAI 没有返回登录凭证'));
			const id = jwtClaims(tok.id_token);
			const aud = Array.isArray(id.aud) ? id.aud : [id.aud];
			if (String(id.iss || '').replace(/\/$/, '') !== SIWC_ISSUER || !aud.includes(clientId) || id.nonce !== nonce) throw new Error(t('登录凭证校验未通过，请重试'));
			if (!String(tok.scope || '').split(/\s+/).includes(SIWC_DIRECT_SCOPE)) throw new Error(t('这个 ChatGPT 账号暂不支持通过 API 使用套餐额度'));
			const oauth = creds('chatgpt', tok, { clientId });
			return { oauth, label: oauth.email || 'ChatGPT' };
		} };
	}
	if (kind === 'openrouter') {
		const redirect = `http://localhost:${49152 + Math.floor(Math.random() * 16000)}/callback`;
		const handle = openSignIn(openRouterAuthUrl(redirect, challenge, state), redirect);
		return { handle, async finish() {
			const back = await handle.result;
			if (back.searchParams.get('state') !== state) throw new Error(t('登录结果与本次请求不符，请重试'));
			const code = back.searchParams.get('code');
			if (!code) throw new Error(t('授权没有完成'));
			const data = await postToken(OPENROUTER_EXCHANGE, { code, code_verifier: verifier, code_challenge_method: 'S256' }, t('授权 OpenRouter'));
			if (typeof data.key !== 'string' || !data.key) throw new Error(t('OpenRouter 没有返回 Key，请重新授权'));
			return { apiKey: data.key, label: 'OpenRouter' };
		} };
	}
	// 词元跳动 hands back an ordinary API key.
	const redirect = `http://127.0.0.1:${49152 + Math.floor(Math.random() * 16000)}/callback`;
	const url = `${TOKENDANCE_AUTH}?${new URLSearchParams({ callback_url: redirect, code_challenge: challenge, code_challenge_method: 'S256', app_url: APP_URL, key_name: 'Qiaomu Clipper' })}`;
	const handle = openSignIn(url, redirect);
	return { handle, async finish() {
		const back = await handle.result;
		const code = back.searchParams.get('code');
		if (!code) throw new Error(t('授权没有完成'));
		const data = await postToken(TOKENDANCE_EXCHANGE, { code, code_verifier: verifier, code_challenge_method: 'S256' }, t('授权词元跳动'));
		if (typeof data.key !== 'string' || !data.key) throw new Error(t('词元跳动没有返回 Key，请重新授权'));
		return { apiKey: data.key, label: t('词元跳动') };
	} };
}

let refreshing: Promise<OAuthCredentials> | undefined;

async function refresh(oauth: OAuthCredentials): Promise<OAuthCredentials> {
	let tok: any;
	try {
		tok = oauth.kind === 'codex'
			? await postToken(CODEX_TOKEN, { client_id: oauth.clientId || CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: oauth.refresh, scope: 'openid profile email' }, t('刷新 Codex 登录'))
			: await postToken(SIWC_TOKEN, new URLSearchParams({ grant_type: 'refresh_token', client_id: oauth.clientId, refresh_token: oauth.refresh, resource: SIWC_RESOURCE }).toString(), t('刷新 ChatGPT 登录'));
	} catch (error) {
		const status = (error as { status?: number }).status;
		if (status === 400 || status === 401) throw new Error(t('{0} 登录已过期，请在设置里重新登录', [oauth.kind === 'codex' ? 'Codex' : 'ChatGPT']));
		throw error;
	}
	if (!tok.access_token) throw new Error(t('刷新登录失败'));
	return creds(oauth.kind, tok, oauth);
}

// The token a request should carry, renewed (and saved) when it is about to expire.
export async function freshOAuth(provider: Provider, save: (oauth: OAuthCredentials) => Promise<void>): Promise<OAuthCredentials> {
	const oauth = provider.oauth;
	if (!oauth) throw new Error(t('{0} 还没有登录', [provider.name]));
	if (oauth.expires - Date.now() > MARGIN_MS) return oauth;
	// Refresh tokens rotate; two requests must not spend the same one.
	refreshing ??= refresh(oauth).then(async next => { provider.oauth = next; await save(next); return next; }).finally(() => { refreshing = undefined; });
	return refreshing;
}

type Turn = { role: 'user' | 'assistant'; content: string };

export function responsesRequest(oauth: OAuthCredentials, model: ModelConfig, system: string, messages: Turn[]): { url: string; init: RequestInit } {
	const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${oauth.access}` };
	let url = `${CHATGPT_BASE}/responses`;
	if (oauth.kind === 'codex') {
		url = `${CODEX_BASE}/responses`;
		if (oauth.accountId) headers['chatgpt-account-id'] = oauth.accountId;
		headers['OpenAI-Beta'] = 'responses=experimental';
		headers.originator = 'codex_cli_rs';
		headers.version = CODEX_VERSION;
	}
	const input = messages.map(m => ({ type: 'message', role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }] }));
	return { url, init: { method: 'POST', headers, credentials: 'omit', body: JSON.stringify({ model: model.providerModelId, instructions: system, input, store: false, stream: true }) } };
}

export function responsesText(line: string): string {
	if (!line.startsWith('data:')) return '';
	const raw = line.slice(5).trim();
	if (!raw || raw === '[DONE]') return '';
	try {
		const data = JSON.parse(raw);
		return data.type === 'response.output_text.delta' && typeof data.delta === 'string' ? data.delta : '';
	} catch { return ''; }
}

export function oauthModelsRequest(oauth: OAuthCredentials): { url: string; headers: Record<string, string> } {
	const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${oauth.access}` };
	if (oauth.kind !== 'codex') return { url: `${CHATGPT_BASE}/models`, headers };
	if (oauth.accountId) headers['chatgpt-account-id'] = oauth.accountId;
	headers.originator = 'codex_cli_rs';
	return { url: `${CODEX_BASE}/models?client_version=${CODEX_VERSION}`, headers };
}

export async function readResponsesStream(response: Response): Promise<string> {
	if (!response.body) throw new Error(t('模型没有返回内容'));
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let text = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) text += responsesText(line.trim());
	}
	return text + responsesText(buffer.trim());
}
