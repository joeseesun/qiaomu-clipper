// Use the actual browsing context's protocol: Reader overwrites document.URL
// with the source article URL for extraction, links and clipping metadata.
export function readerScriptPolicy(protocol: string): string {
	return protocol === 'chrome-extension:'
		? "script-src 'self' 'wasm-unsafe-eval'; object-src 'none';"
		: "script-src 'none'; object-src 'none';";
}
