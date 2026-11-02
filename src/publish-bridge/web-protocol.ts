export const WEB_PUBLISH_ACTION = 'qiaomuWebPublish';
export const WEB_PUBLISH_CHANNEL = 'qiaomu-web-publish-v1';
export function allowedPublishPage(address: string | undefined): boolean {
  try {
    const url = new URL(address || '');
    return !url.username && !url.password && ((url.protocol === 'https:' && url.hostname === 'blog.qiaomu.ai' && !url.port) || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  } catch { return false; }
}
