const crypto = require('node:crypto');
const { marked } = require('marked');
const cheerio = require('cheerio');
const SOURCE_ID = 'user-submitted';
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function publicImage(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return null;
  try {
    const u = new URL(value, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hostname === 'localhost' || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname) || u.hostname.includes(':')) return null;
    return u.href;
  } catch { return null; }
}
function extractCover(content, base, preferred) {
  const cover = publicImage(preferred, base);
  if (cover) return cover;
  const $ = cheerio.load(content || '', null, false);
  for (const node of $('img[src]').toArray()) {
    if (isDecorativeImage($(node).attr('src'), $(node).attr('alt'), $(node).attr('width'), $(node).attr('height'))) continue;
    const image = publicImage($(node).attr('src'), base);
    if (image) return image;
  }
  return null;
}
function isDecorativeImage(value, alt = '', width = '', height = '') {
  let src = String(value || '');
  try { src = decodeURIComponent(src); } catch {}
  if (/profile[_-]?images|avatar|favicon|we-emoji/i.test(src + ' ' + alt)) return true;
  const w = Number(width || /(?:[,/])w_(\d+)/.exec(src)?.[1]);
  const h = Number(height || /(?:[,/])h_(\d+)/.exec(src)?.[1]);
  return (w > 0 && w < 100) || (h > 0 && h < 100);
}
// The site shows clips as text and never runs page HTML, so a Bilibili embed becomes a link to the video.
const BILIBILI_EMBED = /<iframe\b[^>]*?\bsrc=(["'])([^"']*player\.bilibili\.com\/player\.html[^"']*)\1[^<>]*>?\s*(?:<\/iframe>?)?/gi;
function bilibiliEmbedsToLinks(markdown) {
  return markdown.replace(BILIBILI_EMBED, (whole, _quote, src) => {
    try {
      const params = new URL(src.replace(/&amp;/g, '&'), 'https://player.bilibili.com/').searchParams;
      const bvid = params.get('bvid') || '';
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return whole;
      const page = parseInt(params.get('p') || params.get('page') || '1', 10);
      return `[▶ 在 B 站观看](https://www.bilibili.com/video/${bvid}/${page > 1 ? `?p=${page}` : ''})`;
    } catch { return whole; }
  });
}
function prepareClip(body = {}, user = {}, previous = null) {
  const url = new URL(String(body.url || ''));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hostname === 'localhost' || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) || url.hostname.includes(':')) throw Object.assign(new Error('请剪藏公开网页链接'), { statusCode: 400 });
  url.hash = '';
  const markdown = bilibiliEmbedsToLinks(String(body.markdown || '').trim());
  const title = String(body.title || '').trim().slice(0, 300);
  if (!title || !markdown || markdown.length > 500000) throw Object.assign(new Error('剪藏标题或正文无效（正文最多 50 万字符）'), { statusCode: 400 });
  // Escape raw HTML before rendering; downstream reader sanitizes generated HTML as well.
  const $ = cheerio.load(marked.parse(escape(markdown), { async: false }), null, false);
  $('a[href], img[src]').each((_, node) => {
    const attr = node.name === 'a' ? 'href' : 'src';
    try { const target = new URL($(node).attr(attr), url); if (!['http:', 'https:'].includes(target.protocol)) $(node).removeAttr(attr); }
    catch { $(node).removeAttr(attr); }
  });
  const content = $.html();
  const t = previous?.publishedTs || Date.now();
  return { id: crypto.createHash('md5').update(`${SOURCE_ID}|${url.href}`).digest('hex'), sourceId: SOURCE_ID, title, link: url.href,
    author: user.displayName || '乔木剪藏', published: previous?.published || new Date(t).toISOString(), publishedTs: t,
    summary: markdown.replace(/[#*_`>\[\]]/g, '').slice(0, 320), content, image: extractCover(content, url.href, body.image), audio: null };
}
function isClipperClient(req) {
  const origin = String(req.get('origin') || '');
  return (!origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^moz-extension:\/\/[a-f0-9-]+$/.test(origin)) &&
    req.get('X-Qiaomu-Client') === 'web-clipper' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.get('X-Qiaomu-Device') || '');
}
function saveClip(store, body, user = {}, { note = '', client = 'reader' } = {}) {
  const draft = prepareClip(body, user);
  const legacyId = crypto.createHash('md5').update(`qiaomu-clippings|${draft.link}`).digest('hex');
  if (store.isEntryDeleted(draft.id) || store.isEntryDeleted(legacyId)) throw Object.assign(new Error('这个链接已被管理员移除，暂不能重新收录'), { statusCode: 403 });
  const previous = store.getSubmittedEntryByUrl(draft.link) || store.getEntry(draft.id);
  // Preserve the first accepted content across both website and extension retries.
  const entry = previous || store.saveSubmittedEntry(draft, { userId: user.id || null, author: user.displayName || '读者', note });
  if (!previous) store.upsertEntrySignal(entry.id, { provider: 'submitted-content', externalId: draft.link, kind: 'submission', sourceName: '提交正文' });
  if (!previous && client === 'web-clipper') store.upsertEntrySignal(entry.id, { provider: 'web-clipper', externalId: draft.link, kind: 'submission', sourceName: '剪藏插件' });
  return { entry, duplicate: Boolean(previous) };
}
function mountClipper(app, { store, rateLimit, dailyRateLimit, globalRateLimit, onAccepted = () => {} }) {
  const processing = new Map();
  const guard = (req, res, next) => isClipperClient(req) ? next() : res.status(403).json({ error: '请通过乔木剪藏扩展提交' });
  app.post('/api/clipper/clips', guard, rateLimit, dailyRateLimit, globalRateLimit, (req, res) => {
    try {
      const { entry, duplicate } = saveClip(store, req.body, { displayName: '剪藏用户' }, { client: 'web-clipper' });
      if (!processing.has(entry.id)) {
        const job = Promise.resolve().then(() => onAccepted(entry))
          .catch(error => console.warn(`Clip metadata enrichment skipped for ${entry.id}:`, error.message || error))
          .finally(() => processing.delete(entry.id));
        processing.set(entry.id, job);
      }
      // Earlier installed extensions only accept the old sourceId in acknowledgements.
      const sourceId = req.get('X-Qiaomu-Submission-Version') === '2' ? SOURCE_ID : 'qiaomu-clippings';
      return res.status(duplicate ? 200 : 201).json({ accepted: true, duplicate, entryId: entry.id, sourceId, canonicalSourceId: SOURCE_ID });
    } catch (e) { return res.status(e.statusCode || 400).json({ error: e.statusCode ? e.message : '剪藏链接无效' }); }
  });
  const feed = (req, res) => {
    const entries = store.getSubmittedEntries({ limit: 100 });
    const items = entries.map(e => `<item><guid isPermaLink="false">${escape(e.id)}</guid><title>${escape(e.title)}</title><link>${escape(e.link)}</link><pubDate>${new Date(e.publishedTs).toUTCString()}</pubDate><description>${escape(e.content)}</description></item>`).join('');
    res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>读者提交</title><link>https://rss.qiaomu.ai/</link><description>读者提交的公开链接与正文</description>${items}</channel></rss>`);
  };
  app.get('/feeds/user-submitted.xml', feed);
  app.get('/feeds/qiaomu-clippings.xml', feed);
}
module.exports = { SOURCE_ID, prepareClip, saveClip, isClipperClient, mountClipper, extractCover, isDecorativeImage };
