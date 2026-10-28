// A small, explicit connectivity check before offering any component download.
// This tests the official Grok download service, not account/subscription access
// or X page extraction. No credentials, cookies or article URLs are sent.
export async function checkXSetupConnection(signal: AbortSignal): Promise<boolean> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) controller.abort();
	const timeout = setTimeout(abort, 10_000);
	try {
		const response = await fetch('https://x.ai/cli/stable', {
			method: 'HEAD', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
		});
		return response.ok;
	} catch { return false; }
	finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
