import { describe, expect, it, vi, afterEach } from 'vitest';
import { detectMagpie, magpieKey } from './magpie';
import { CATALOG } from './provider-catalog';
import { modelListRequest } from './provider-models';
afterEach(() => vi.unstubAllGlobals());
describe('Magpie and plan access', () => {
 it('keeps distinct official Coding Plan endpoints', () => {
  const plans = CATALOG.filter(p => p.group === 'plan'); expect(plans).toHaveLength(7);
  expect(plans.find(p => p.id === 'kimi-code')?.baseUrl).toBe('https://api.kimi.com/coding/v1/chat/completions');
  expect(plans.find(p => p.id === 'glm-coding')?.baseUrl).toContain('/api/coding/paas/v4/');
 });
 it('permits an empty key only on true loopback addresses', () => {
  const p = { presetId: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1/chat/completions', apiKey: '' };
  expect(magpieKey(p)).toBe('magpie-qiaomu-clipper');
  for (const baseUrl of ['https://127.0.0.1.example.com/v1', 'http://gateway.example/v1', 'https://user:secret@gateway.example/v1', 'https://gateway.example/v1?key=secret']) expect(() => magpieKey({ ...p, baseUrl })).toThrow();
  expect(magpieKey({ ...p, baseUrl: 'https://gateway.example/v1', apiKey: 'fixture' })).toBe('fixture');
 });
 it('uses the same gateway authentication for model discovery', () => {
  const req = modelListRequest({ id: 'fixture', name: 'Magpie', presetId: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1/chat/completions', apiKey: '' });
  expect(req.url.href).toBe('http://127.0.0.1:3425/v1/models'); expect(req.headers.Authorization).toBe('Bearer magpie-qiaomu-clipper');
 });
 it('detects a gateway through a proxy prefix, rejects unrelated servers', async () => {
  const mock = vi.fn(async (_url: string) => Response.json({ name: 'magpie', version: 'fixture' })); vi.stubGlobal('fetch', mock);
  const p = { presetId: 'magpie', baseUrl: 'https://gateway.example/proxy/v1/chat/completions', apiKey: 'fixture' };
  expect(await detectMagpie(p)).toBe('fixture'); expect(mock.mock.calls[0]?.[0]).toBe('https://gateway.example/proxy/api/hello');
  mock.mockImplementation(async () => Response.json({ name: 'other' })); await expect(detectMagpie(p)).rejects.toThrow();
 });
});
