// @vitest-environment jsdom
import { expect, it } from 'vitest';

type Listener = (message: any) => void;
const connectListeners: ((port: any) => void)[] = [];
(globalThis as any).chrome = { runtime: { onConnect: { addListener: (fn: (port: any) => void) => connectListeners.push(fn) } } };

function openPort(name = 'qiaomu-write-x') {
	const received: any[] = [];
	const handlers: Listener[] = [];
	const port = { name, postMessage: (message: any) => received.push(message), onMessage: { addListener: (fn: Listener) => handlers.push(fn) }, onDisconnect: { addListener: () => {} } };
	connectListeners.forEach(fn => fn(port));
	return { received, send: (message: any) => handlers.forEach(fn => fn(message)) };
}

it('answers a ping from the writer page and says it is not on an X Articles page', async () => {
	await import('./x-content');
	expect(connectListeners.length).toBe(1);
	const { received, send } = openPort();
	send({ type: 'ping' });
	expect(received[0]).toMatchObject({ type: 'pong', route: false, editor: false });
});

it('ignores ports that are not the writer\'s and refuses to write outside an X Articles page', async () => {
	const stranger = openPort('someone-else');
	stranger.send({ type: 'ping' });
	expect(stranger.received).toEqual([]);

	const { received, send } = openPort();
	send({ type: 'run', markdown: '---\ntitle: "t"\n---\n\n正文' });
	await new Promise(resolve => setTimeout(resolve, 20));
	const error = received.find(message => message.type === 'error');
	expect(error?.error).toContain('X 文章页');
	expect(document.getElementById('__qiaomu_write_status__')?.textContent).toContain('写入失败');
});
