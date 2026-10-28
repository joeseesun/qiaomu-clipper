"""Deterministic X Article extraction from X's own server-rendered page.

Decode JSON string literals, never execute the page's JavaScript. The plain_text
field omits atomic blocks: render content_state AND entity_map instead.
"""
import base64
import json
import re
from urllib.parse import urlsplit, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

MAX_HTML = 8 * 1024 * 1024
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'


class XRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        from x_articles import canonical_url
        try:
            canonical_url(newurl)  # Only X post/article paths; never follow login/off-site redirects.
        except ValueError as error:
            # The requested link was valid; X's login redirect means the direct
            # page is unavailable. Let the existing Grok locator try its path.
            raise ValueError('x-page-unavailable') from error
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_html(url):
    from x_articles import canonical_url
    url = canonical_url(url)
    try:
        with build_opener(XRedirects).open(Request(url, headers={'User-Agent': UA, 'Accept': 'text/html', 'Accept-Encoding': 'identity'}), timeout=25) as response:
            canonical_url(response.url)
            if 'text/html' not in response.headers.get('Content-Type', ''):
                raise ValueError('x-body-missing')
            data = response.read(MAX_HTML + 1)
            if len(data) > MAX_HTML:
                raise ValueError('x-too-large')
            return data.decode('utf8')
    except HTTPError as error:
        raise ValueError('x-rate-limited' if error.code == 429 else 'x-page-unavailable') from error


def page_payloads(html):
    # X's TanStack SSR stream embeds GraphQL results as JSON inside JS strings.
    # JavaScript's \xHH escaping is the only observed difference from JSON syntax.
    for match in re.finditer(r'\bvalue:("(?:\\.|[^"\\])*")', html):
        try:
            # Consume pairs of escapes first: a literal backslash followed by x
            # inside a code sample must not turn into a character.
            literal = re.sub(r'\\(?:x[0-9a-fA-F]{2}|.)',
                             lambda m: '\\u00' + m[0][2:] if m[0].startswith('\\x') else m[0], match[1])
            payload = json.loads(json.loads(literal))
            if isinstance(payload, dict):
                yield payload
        except (ValueError, TypeError):
            continue


def safe_link(url):
    if not isinstance(url, str) or len(url) > 8192:
        raise ValueError('x-source-unverified')
    u = urlsplit(url)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or re.search(r'[\x00-\x20]', url):
        raise ValueError('x-source-unverified')
    return quote(url, safe=':/?#[]@!$&\'*+,;=%_-~.')


def md_label(text):
    return str(text).replace('\\', '\\\\').replace('[', '\\[').replace(']', '\\]').replace('\n', ' ')


def inline_text(block, entities):
    text = block['text']
    raw = text.encode('utf-16-le')
    starts, ends = {}, {}
    for span in block.get('entity_ranges', []):
        entity = entities.get(str(span.get('key')))
        if not entity or entity.get('type') != 'LINK':
            raise ValueError('x-source-unverified')
        start, end = span['offset'], span['offset'] + span['length']
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(raw) // 2:
            raise ValueError('x-source-unverified')
        starts.setdefault(start, []).append('[')
        ends.setdefault(end, []).insert(0, '](' + safe_link(entity['data']['url']) + ')')
    # Keep ordinary formatting without touching the source's text characters.
    styles = {'Bold': '**', 'BOLD': '**', 'Italic': '*', 'ITALIC': '*', 'Strikethrough': '~~', 'STRIKETHROUGH': '~~', 'Code': '`', 'CODE': '`'}
    for span in block.get('inline_style_ranges', []):
        marker = styles.get(span.get('style'))
        if not marker:
            continue
        start, end = span['offset'], span['offset'] + span['length']
        if not 0 <= start < end <= len(raw) // 2:
            raise ValueError('x-source-unverified')
        starts.setdefault(start, []).append(marker)
        ends.setdefault(end, []).insert(0, marker)
    positions = sorted(set([0, len(raw) // 2, *starts, *ends]))
    output = ''
    for i, at in enumerate(positions):
        output += ''.join(ends.get(at, [])) + ''.join(starts.get(at, []))
        if i + 1 < len(positions):
            output += raw[at * 2:positions[i + 1] * 2].decode('utf-16-le')
    return output


def render_article(article):
    state = article.get('content_state', {})
    blocks = state.get('blocks')
    if not isinstance(blocks, list) or not blocks or len(blocks) > 20000:
        raise ValueError('x-body-missing')
    entities = {str(e['key']): e['value'] for e in state.get('entity_map', [])}
    media = {str(m['media_id']): m['media_info'] for m in article.get('media_entities', [])}
    parts, codes, images, embeds = [], 0, 0, 0
    headings = {'header-one': '# ', 'header-two': '## ', 'header-three': '### ', 'header-four': '#### '}
    for block in blocks:
        kind = block.get('type')
        if kind == 'atomic':
            ranges = block.get('entity_ranges', [])
            if len(ranges) != 1:
                raise ValueError('x-source-unverified')
            entity = entities.get(str(ranges[0].get('key')), {})
            data = entity.get('data', {})
            if entity.get('type') == 'MARKDOWN':
                if not isinstance(data.get('markdown'), str) or not data['markdown'].strip():
                    raise ValueError('x-body-missing')
                parts.append(data['markdown']); codes += 1
            elif entity.get('type') == 'MEDIA':
                items = data.get('media_items', [])
                if not items:
                    raise ValueError('x-body-missing')
                for item in items:
                    info = media.get(str(item.get('media_id')), {})
                    url = info.get('original_img_url')
                    if not url:
                        raise ValueError('x-media-unsupported')
                    parts.append('![' + md_label(data.get('caption', '')) + '](' + safe_link(url) + ')')
                    images += 1
                if data.get('caption'):
                    parts.append(data['caption'])
            elif entity.get('type') == 'TWEET' and re.fullmatch(r'\d{5,25}', str(data.get('tweet_id', ''))):
                # Preserve embedded references as links, without inventing their contents.
                parts.append('> https://x.com/i/status/' + str(data['tweet_id'])); embeds += 1
            else:
                raise ValueError('x-source-unverified')
        elif kind in {'unstyled', 'blockquote', 'unordered-list-item', 'ordered-list-item', 'code-block', *headings}:
            if not isinstance(block.get('text'), str):
                raise ValueError('x-source-unverified')
            value = inline_text(block, entities)
            if kind in headings:
                value = headings[kind] + value
            elif kind == 'blockquote':
                value = '> ' + value.replace('\n', '\n> ')
            elif kind in {'unordered-list-item', 'ordered-list-item'}:
                depth = block.get('depth', 0)
                if type(depth) is not int or not 0 <= depth <= 10:
                    raise ValueError('x-source-unverified')
                value = '  ' * depth + ('- ' if kind == 'unordered-list-item' else '1. ') + value
            elif kind == 'code-block':
                fence = '`' * max(3, max((len(x) for x in re.findall(r'`+', value)), default=0) + 1)
                value = fence + '\n' + value + '\n' + fence; codes += 1
            parts.append(value)
        else:
            raise ValueError('x-source-unverified')
    cover = (article.get('cover_media_results') or {}).get('result', {}).get('media_info', {}).get('original_img_url')
    counts = {'blocks': len(blocks), 'codeBlocks': codes, 'images': images, 'embeddedPosts': embeds}
    if cover:
        parts.insert(0, '![](' + safe_link(cover) + ')')
        counts['coverImages'] = 1
    return '\n\n'.join(parts), counts


def extract_page(html, url):
    from x_articles import canonical_url, _article
    url = canonical_url(url)
    target = url.rsplit('/', 1)[-1]
    is_article_url = '/article/' in url
    post = None
    article_reference = False
    for payload in page_payloads(html):
        entry = payload.get('data', {}).get('tweet_result_by_rest_id', {})
        tweet = entry.get('result', {})
        article = (tweet.get('article') or {}).get('article_results', {}).get('result', {})
        matching_post = target in {str(entry.get('rest_id', '')), str(tweet.get('rest_id', ''))}
        if matching_post and not is_article_url:
            article_reference |= bool(tweet.get('article'))
            post = tweet
        if not article.get('content_state'):
            continue
        if is_article_url:
            try:
                article_id = base64.b64decode(article.get('id', '')).decode().split(':')[-1]
            except (ValueError, UnicodeError):
                continue
            if target not in {article_id, str(entry.get('rest_id', '')), str(tweet.get('rest_id', ''))}:
                continue
        elif target not in {str(entry.get('rest_id', '')), str(tweet.get('rest_id', ''))}:
            continue
        body, counts = render_article(article)
        user = tweet.get('core', {}).get('user_results', {}).get('result', {})
        author = user.get('core', {}).get('name') or user.get('legacy', {}).get('name') or ''
        result = _article(url, article.get('title'), author, body, 'article')
        result.update(provenance='x-original-page', structure=counts)
        return result, article
    # Long notes use note_tweet.text. An Article preview must never masquerade
    # as a complete ordinary post when its Article payload was not supplied.
    if post and not article_reference:
        legacy = post.get('legacy', {})
        note = post.get('note_tweet', {}).get('note_tweet_results', {}).get('result', {})
        body = note.get('text') or legacy.get('full_text')
        if legacy.get('truncated') and not note.get('text'):
            raise ValueError('x-source-truncated')
        user = post.get('core', {}).get('user_results', {}).get('result', {})
        author = user.get('core', {}).get('name') or user.get('legacy', {}).get('name') or ''
        return _article(url, author or 'X', author, body, 'post'), post
    raise ValueError('x-body-missing')
