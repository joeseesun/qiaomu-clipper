import type { Provider } from '../types/types';

export function magpieKey(provider: Pick<Provider, 'presetId' | 'baseUrl' | 'apiKey'>): string {
  if (provider.presetId !== 'magpie') return provider.apiKey;
  const url = new URL(provider.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Magpie requires HTTPS; HTTP is allowed only on localhost.');
  if (!local && !provider.apiKey.trim()) throw new Error('Remote Magpie requires a gateway key.');
  return provider.apiKey.trim() || 'magpie-qiaomu-clipper';
}
export async function detectMagpie(provider: Pick<Provider, 'presetId' | 'baseUrl' | 'apiKey'>, signal?: AbortSignal): Promise<string> {
  const key = magpieKey(provider), url = new URL(provider.baseUrl);
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|responses)\/?$/, '').replace(/\/v1\/?$/, '') + '/api/hello';
  const response = await fetch(url.href, { headers: { Authorization: `Bearer ${key}` }, credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Magpie HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('name' in body) || body.name !== 'magpie') throw new Error('Magpie was not detected.');
  return 'version' in body && typeof body.version === 'string' ? body.version : '';
}
