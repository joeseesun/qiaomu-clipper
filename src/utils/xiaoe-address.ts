// One catalogue for the study entry and short-link resolver. Verified share hosts
// are separate from shop hosts and media hosts; a short link is not a media URL.
export const XIAOE_SHORT_HOSTS = ['xet.tech', 'xetslk.com', 'xetlk.com'];
export const XIAOE_PAGE_HOSTS = ['xiaoeknow.com', 'xiaoe-tech.com', 'xet.citv.cn', 'xet.pomoho.com'];
export const XIAOE_HOSTS = [...XIAOE_SHORT_HOSTS, ...XIAOE_PAGE_HOSTS];
const APP = /^app[0-9a-z]{6,24}$/i;
const LIVE = /^l_[0-9a-z_]{8,64}$/i;
const SHOP = /^(app[0-9a-z]{6,24})\.(?:(h5|mp)\.(xiaoeknow\.com|xiaoe-tech\.com)|(?:(h5|mp)\.)?(xet\.citv\.cn|xet\.pomoho\.com))$/i;
const matches = (host: string) => XIAOE_HOSTS.some(item => host === item || host.endsWith('.' + item));
const safeUrl = (address: string): URL | null => {
 try { const u = new URL(address); if (u.hash === '#wechat_redirect') u.hash = ''; return address.length <= 12000 && u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && !u.hash ? u : null; } catch { return null; }
};
export const isXiaoeLink = (address: string): boolean => { const u = safeUrl(address); return !!u && matches(u.hostname); };
const decodeBase64Json = (text: string): Record<string, unknown> | null => {
 try {
  const padded = text.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); const value = JSON.parse(new TextDecoder().decode(bytes));
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
 } catch { return null; }
};
export const xiaoeLiveAddress = (app: string, live: string, origin = `https://${app.toLowerCase()}.h5.xiaoeknow.com`) => `${origin}/v4/course/alive/${live}?app_id=${app}`;

function addressOf(address: string, depth: number): string | null {
 if (depth > 3) return null;
 const u = safeUrl(address), shop = u?.hostname.match(SHOP); if (!u || !shop) return null;
 const page = u.pathname.match(/^\/content_page\/([^?#]+)$/)?.[1];
 let old: Record<string, unknown> | null = null; try { old = page ? decodeBase64Json(decodeURIComponent(page)) : null; } catch { /* bad encoding */ }
 const inner = u.searchParams.get('params') ? decodeBase64Json(u.searchParams.get('params')!) : old;
 const app = u.searchParams.get('app_id') || (typeof inner?.app_id === 'string' ? inner.app_id : shop[1]);
 if (!APP.test(app) || app.toLowerCase() !== shop[1].toLowerCase() || (inner?.app_id !== undefined && (typeof inner.app_id !== 'string' || inner.app_id.toLowerCase() !== app.toLowerCase()))) return null;
 // Keep the actual first-party shop origin: login cookies never cross aliases.
 const origin = u.origin.replace(/\.mp\./, '.h5.');
 const live = u.pathname.match(/^\/(?:v[0-9]+|p)\/course\/alive\/(l_[0-9a-z_]+)\/?$/i)?.[1];
 if (live && LIVE.test(live)) return xiaoeLiveAddress(app, live, origin);
 // A short share can land on the shop's own login wrapper. Read only its
 // same-shop live destination, without reading any credential or login form.
 if (/^\/(?:v[0-9]+\/auth|p\/t\/free\/v[0-9]+\/basic-platform\/h5_basic\/login\/auth)\/?$/.test(u.pathname)) {
  const next = u.searchParams.get('redirect_url'), resolved = next ? addressOf(next, depth + 1) : null;
  if (resolved && new URL(resolved).hostname.match(SHOP)?.[1].toLowerCase() === app.toLowerCase()) return resolved;
 }
 if (inner) {
  const resource = typeof inner.resource_id === 'string' ? inner.resource_id : '';
  const embedded = typeof inner.h5_url === 'string' ? addressOf(inner.h5_url, depth + 1) : null;
  if (embedded) {
   const parsed = new URL(embedded);
   if (parsed.hostname.match(SHOP)?.[1].toLowerCase() === app.toLowerCase() && (!resource || parsed.pathname.split('/').pop() === resource)) return embedded;
   return null;
  }
  if (LIVE.test(resource)) return xiaoeLiveAddress(app, resource, origin);
 }
 return null;
}
export const xiaoeAddress = (address: string): string | null => addressOf(address, 0);
export function xiaoeParts(address: string): { app: string; live: string; origin: string } | null {
 const canonical = xiaoeAddress(address); if (!canonical) return null;
 const u = new URL(canonical); return { app: u.searchParams.get('app_id')!, live: u.pathname.split('/').pop()!, origin: u.origin };
}
