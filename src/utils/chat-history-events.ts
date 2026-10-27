export interface HistoryChange { type: 'deleted' | 'cleared' | 'cleanup'; pageKey?: string; id?: string }
const listeners = new Set<(change: HistoryChange) => void>();
let channel: BroadcastChannel | undefined;
export function watchHistoryChanges(listener: (change: HistoryChange) => void): () => void {
	listeners.add(listener);
	if (!channel && typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
		channel = new window.BroadcastChannel('qiaomu-chat-history');
		channel.onmessage = event => { if (['deleted', 'cleared', 'cleanup'].includes(event.data?.type)) for (const receive of listeners) receive(event.data); };
	}
	return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = undefined; } };
}
export function notifyHistoryChange(change: HistoryChange): void {
	for (const listener of listeners) listener(change);
	if (channel) channel.postMessage(change);
	else if (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
		const temporary = new window.BroadcastChannel('qiaomu-chat-history'); temporary.postMessage(change); temporary.close();
	}
}
