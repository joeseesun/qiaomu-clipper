import { expect, it, vi } from 'vitest';
import { relayPort, sendAssets } from './relay';
import type { BridgeClient } from './client';

it('does not send an image that finished loading after the person cancelled', async () => {
 const post = vi.fn();
 const client = { cancelled: false, asset: async () => { client.cancelled = true; return new ArrayBuffer(1); } } as unknown as BridgeClient;
 await expect(sendAssets(client, [{ id: 'one', name: 'one.png', mime: 'image/png', bytes: 1 }], post, a => a.id, () => {})).rejects.toMatchObject({ stopped: true });
 expect(post).not.toHaveBeenCalled();
});
it('does not start the page writer after cancellation and reports cancelled rather than failure', async () => {
 const client = { cancelled: true, status: async () => {} } as unknown as BridgeClient;
 const postMessage = vi.fn();
 const port = { postMessage, onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} } } as any;
 const result = await relayPort(port, client, async post => { post({ type: 'run' }); throw Object.assign(new Error('stopped'), { stopped: true }); });
 expect(postMessage).not.toHaveBeenCalled(); expect(result.cancelled).toBe(true);
});
