import browser from './utils/browser-polyfill';
import { allowedPublishPage, WEB_PUBLISH_ACTION, WEB_PUBLISH_CHANNEL } from './publish-bridge/web-protocol';

// Isolated-world listener: only the top-level allowlisted blog can reach this API.
if (window === window.top && allowedPublishPage(location.href)) {
  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== WEB_PUBLISH_CHANNEL || request.direction !== 'request' || typeof request.id !== 'string' || request.id.length > 100) return;
    const reply = (result: unknown) => window.postMessage({ channel: WEB_PUBLISH_CHANNEL, direction: 'response', id: request.id, result }, location.origin);
    void browser.runtime.sendMessage({ action: WEB_PUBLISH_ACTION, kind: request.kind, payload: request.payload }).then(reply).catch(() => reply({ error: '浏览器发布连接已中断，请稍后重试。' }));
  });
}
