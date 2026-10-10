// Official Chat Completions capability snapshot, verified 2026-10-10:
// https://opencode.ai/docs/go/#endpoints . /models currently returns bare IDs,
// including Messages/Responses models; unknown capabilities must not be guessed.
const CHAT_MODELS = new Set([
 'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6',
 'longcat-2.0', 'longcat-2.5-preview-free', 'step-5-preview-free',
 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp',
 'mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5', 'mimo-v2.5-pro', 'hy4-preview', 'hy3', 'space-bunny',
]);

function opencodeUrl(raw: string): URL | undefined {
 try {
  const url = new URL(raw);
  if (url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
   && (url.hostname === 'opencode.ai' || url.hostname.endsWith('.opencode.ai'))) return url;
 } catch { /* custom provider URL may be incomplete while editing */ }
 return undefined;
}

export function isOpenCodeGo(raw: string): boolean {
 const url = opencodeUrl(raw);
 return !!url && /^\/zen\/go\/v1(?:\/|$)/.test(url.pathname);
}

export function supportsOpenCodeGoChat(raw: string, model: string): boolean {
 if (!isOpenCodeGo(raw)) return true;
 const path = new URL(raw).pathname.replace(/\/+$/, '');
 return (path === '/zen/go/v1' || path === '/zen/go/v1/chat/completions') && CHAT_MODELS.has(model);
}

export function validChatSession(id: unknown): id is string {
 return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

// Conversation IDs are persisted by chat-history, so page/worker reloads retain
// routing identity. Discovery and standalone requests get their own transient ID.
export function opencodeHeaders(baseUrl: string, sessionId?: string): Record<string, string> | undefined {
 if (!opencodeUrl(baseUrl)) return undefined;
 if (sessionId !== undefined && !validChatSession(sessionId)) throw new Error('Invalid chat session ID');
 return { 'x-opencode-session': sessionId ?? crypto.randomUUID(), 'x-opencode-client': 'qiaomu-clipper', 'User-Agent': 'qiaomu-clipper/1.15.8' };
}
