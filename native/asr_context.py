"""What the page says about a video or episode (title, author, description, chapters), turned into the background text a
recogniser can use to spell names and terms right. Entirely rules: no model, nothing curated per programme.

Tried on a real episode (a guest named 曾鸣): without background Whisper wrote 曾敏 and Qwen3-ASR wrote 曾明; with the show notes
as background both wrote 曾鸣, and Doubao fixed the host's name. Services that did not change (SiliconFlow, GLM, StepFun) or that
refused extra text (MiMo) are sent nothing.
"""
import html, json, re

# Room for the background, in characters, by what reads it. Whisper only looks at the last 224 tokens of its prompt.
BUDGET_QWEN, BUDGET_DOUBAO, BUDGET_PROMPT = 1200, 700, 160
URL = re.compile(r'(?:https?://|www\.)\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b', re.I)
EMOJI = re.compile('[\U0001F000-\U0001FAFF☀-➿️‍⭐⬆]')
STAMP = re.compile(r'(?<![\d:])(?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?![\d:])')
HASHTAG = re.compile(r'[#＃]([^\s#＃]+)')
# Lines that ask for something or advertise: they say nothing about what is spoken.
BOILERPLATE = re.compile(r'关注|订阅|转发|点赞|三连|投币|收藏|商务合作|合作联系|联系方式|微信|公众号|小红书|微博|抖音|赞助|广告|优惠|折扣|下载|APP|扫码|二维码|加群|入群|社群|版权|转载|免责|follow|subscribe|sponsor|patreon|discount|promo code|affiliate|business inquir|copyright|all rights|link in|click|my (?:course|book|newsletter)|instagram|twitter|facebook|tiktok|discord|spotify|apple podcasts', re.I)
BULLET = re.compile(r'^[\s\-–—•·*▪■●◆▶►>]+')

def clean_line(line):
    line = html.unescape(str(line)); line = re.sub(r'<[^>]+>', ' ', line); line = html.unescape(line); line = URL.sub(' ', line); line = EMOJI.sub(' ', line); line = HASHTAG.sub(r'\1', line); line = STAMP.sub(' ', line)
    line = BULLET.sub('', line); line = re.sub(r'[\u0000-\u001f]', ' ', line)
    return re.sub(r'\s+', ' ', line).strip(' \t|｜-–—:：,，;；')

def clean_lines(text):
    out, seen = [], set()
    for raw in re.split(r'[\r\n]+', str(text or '')):
        line = clean_line(raw)
        if len(line) < 2 or BOILERPLATE.search(line) or not re.search(r'[\w一-鿿]', line): continue
        key = re.sub(r'\W+', '', line).lower()
        if key in seen: continue
        seen.add(key); out.append(line)
    return out

def compose(meta):
    """Title and author first (the most telling), then chapter titles, then the description."""
    meta = meta or {}
    head = [clean_line(meta.get('title') or ''), clean_line(meta.get('show') or meta.get('author') or '')]
    head = [x for x in head if x]
    chapters = [clean_line(x) for x in (meta.get('chapters') or [])[:40]]
    return head, [x for x in chapters if len(x) >= 2], clean_lines(meta.get('description'))

def fit(text, limit, keep='start'):
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) <= limit: return text
    return ('…' + text[-(limit - 1):]) if keep == 'end' else (text[:limit - 1] + '…')

def background(meta, limit):
    """Background for recognisers that read it whole (Qwen3-ASR, Doubao): identity first, then as much of the rest as fits."""
    head, chapters, description = compose(meta)
    if not (head or chapters or description): return ''
    parts = ['。'.join(head)] if head else []
    if chapters: parts.append('章节：' + '；'.join(chapters))
    parts.extend(description)
    out = ''
    for part in parts:
        room = limit - len(out) - 1
        if room < 8: break
        out += ('\n' if out else '') + (part if len(part) <= room else part[:room - 1] + '…')
    return out.strip()

def prompt(meta, limit=BUDGET_PROMPT):
    """A short prompt for Whisper-style recognisers, which only weigh the end of it: the description (trimmed) first, then who and what, last."""
    head, chapters, description = compose(meta)
    if not (head or chapters or description): return ''
    lead = ' '.join(description)[:max(0, limit)]
    tail = '。'.join(head) + ('。' if head else '')
    return fit(((lead + ' ') if lead else '') + tail, limit, keep='end')

def doubao(meta, limit=BUDGET_DOUBAO):
    """Doubao's `corpus.context`: a JSON string whose context_data holds the background text."""
    text = background(meta, limit)
    return json.dumps({'context_type': 'dialog_ctx', 'context_data': [{'text': text}]}, ensure_ascii=False) if text else ''

def from_ytdlp(info):
    """From yt-dlp's info json (YouTube and Bilibili alike)."""
    if not isinstance(info, dict): return {}
    chapters = [c.get('title') for c in (info.get('chapters') or []) if isinstance(c, dict) and c.get('title')]
    tags = [t for t in (info.get('tags') or []) if isinstance(t, str)][:12]
    description = str(info.get('description') or '')
    if tags: description += '\n' + ' '.join(tags)
    return {'title': info.get('title') or '', 'author': info.get('uploader') or info.get('channel') or '', 'description': description, 'chapters': chapters}

def from_rss_item(item):
    return {k: item.get(k) for k in ('title', 'show', 'description') if item.get(k)}

def from_podcast_page(page):
    """From a Xiaoyuzhou episode page: title, show name and the show notes."""
    def meta(prop):
        m = re.search(r'<meta[^>]+property="%s"[^>]+content="([^"]*)"' % re.escape(prop), page); return html.unescape(m.group(1)) if m else ''
    notes = re.search(r'<div class="sn-content"><article>(.*?)</article>', page, re.S)
    text = re.sub(r'</(?:p|li|h\d|blockquote|div)>|<br\s*/?>', '\n', notes.group(1)) if notes else ''
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    show = re.search(r'class="[^"]*podcast-title[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</a>', page)
    title = re.sub(r'\s*[|｜-]\s*小宇宙.*$', '', meta('og:title')).strip()
    return {'title': title, 'show': html.unescape(show.group(1)).strip() if show else '', 'description': text}
