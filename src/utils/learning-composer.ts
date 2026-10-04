import { createElement, NotebookPen, Play, X } from 'lucide';
import * as records from './learning-record';
import { clockLabel } from './learning-record';
import { generalSettings } from './storage-utils';
import type { LearningSource, LearningRecordDraft, DailyTargetResult } from './learning-record';
import { bilibiliVideo } from './video-source';
import { addMark, loadMarks, MARKS_EVENT, renderMarks } from './learning-marks';
import { youtubeVideoId } from './youtube-url';

type Services = Pick<typeof records, 'createLearningDraft' | 'loadLearningDraft' | 'persistLearningDraft' | 'getDailyTarget' | 'saveLearningRecord' | 'dispatchLearningRecord'>;
export interface LearningEntry { quote?: string; aiSupplement?: string }
export interface LearningNotes { button: HTMLButtonElement; open: (entry?: LearningEntry) => Promise<void>; dispose: () => void; updateSource: (getSource: () => LearningSource, getHighlights?: () => string[]) => void }
const mounts = new WeakMap<Document, LearningNotes>();
export const learningNotes = (doc: Document) => mounts.get(doc);

// Only a selection whose two ends belong to the article is eligible. Never read its unselected text.
export function learningSelection(doc: Document): string {
  const selection = doc.getSelection(), article = doc.querySelector('article');
  if (!article || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return '';
  if (!article.contains(selection.anchorNode) || !article.contains(selection.focusNode)) return '';
  return selection.toString().trim();
}

// The transcript line that is currently highlighted (follows the playhead on YouTube, the last jump elsewhere).
export function activeSegmentTime(doc: Document): number | undefined {
  const raw = doc.querySelector('.transcript-segment.is-active .timestamp')?.getAttribute('data-timestamp');
  return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : undefined;
}

export function learningTimestamp(doc: Document): number | undefined {
  const selection = doc.getSelection();
  const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
  const segment = selection && !selection.isCollapsed ? anchor?.closest('.transcript-segment') : undefined;
  const raw = segment?.querySelector('.timestamp')?.getAttribute('data-timestamp');
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
  const video = doc.querySelector<HTMLVideoElement>('article video');
  return video && video.readyState > 0 && Number.isFinite(video.currentTime) ? video.currentTime : undefined;
}

// `getTime` supplies the playhead on a plain video page; `singleKey: false` leaves the page's own N key alone.
export function mountLearningNotes(options: { doc: Document; getSource: () => LearningSource; getHighlights?: () => string[]; getTime?: () => number | undefined; singleKey?: boolean; services?: Services }): LearningNotes {
  const { doc } = options;
  const previous = mounts.get(doc);
  if (previous && doc.querySelector('.learning-composer')) { previous.updateSource(options.getSource, options.getHighlights); return previous; }
  previous?.dispose();
  const service = options.services || records; let getSource = options.getSource, getHighlights = options.getHighlights;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
    const element = doc.createElement(tag); element.textContent = text; element.className = className; return element;
  };
  const button = node('button', '', 'learning-note-entry'); button.type = 'button';
  button.title = '记笔记（N）— 保存到今天的日记'; button.setAttribute('aria-label', '记到今天日记'); button.append(createElement(NotebookPen));
  button.addEventListener('mousedown', event => event.preventDefault());
  // A small non-modal card: the video keeps playing and the transcript stays selectable while you write.
  const dialog = node('dialog', '', 'learning-composer'); dialog.setAttribute('aria-label', '记到今天日记');
  const form = node('form'); form.noValidate = true;
  const header = node('header'); const closeButton = node('button', '', 'learning-close'); closeButton.type = 'button';
  closeButton.title = '关闭并保留草稿（Esc）'; closeButton.setAttribute('aria-label', '关闭并保留草稿'); closeButton.append(createElement(X));
  const timeChip = node('button', '', 'learning-time-chip'); timeChip.type = 'button'; timeChip.hidden = true; timeChip.title = '这条笔记对应的视频时间，点击修改';
  const titleWrap = node('div', '', 'learning-title'); titleWrap.append(node('h2', '记笔记'), timeChip);
  header.append(titleWrap, closeButton);
  const status = node('p', '', 'learning-status'); status.setAttribute('role', 'status');
  const field = (label: string, tag: 'input' | 'textarea' = 'textarea') => {
    const wrap = node('label', label, 'learning-field'); const input = node(tag); input.setAttribute('aria-label', label); wrap.append(input); return { wrap, input };
  };
  const reflection = field('我的理解'); const reflectionInput = reflection.input as HTMLTextAreaElement;
  reflection.wrap.classList.add('learning-main'); reflectionInput.rows = 4; reflectionInput.placeholder = '写下你的想法…  ⌘/Ctrl + Enter 保存';
  // The excerpt is part of the note, so it is shown as a quotation rather than hidden in a settings-like panel.
  const quote = field('原文摘录'); const quoteInput = quote.input as HTMLTextAreaElement; quoteInput.rows = 2;
  const quoteBlock = node('div', '', 'learning-quote'); quoteBlock.hidden = true;
  const removeQuote = node('button', '移除摘录', 'learning-secondary'); removeQuote.type = 'button';
  quote.wrap.classList.add('learning-quote-field'); quoteBlock.append(quote.wrap, removeQuote);
  const sourceTitle = field('来源标题', 'input'), sourceUrl = field('来源链接', 'input'), time = field('视频时间（秒）', 'input');
  const titleInput = sourceTitle.input as HTMLInputElement, urlInput = sourceUrl.input as HTMLInputElement, timeInput = time.input as HTMLInputElement;
  urlInput.type = 'url'; timeInput.type = 'number'; timeInput.min = '0'; timeInput.step = '1';
  const details = node('details', '', 'learning-more'); details.append(node('summary', '来源与时间'));
  const removeSource = node('button', '移除来源与时间', 'learning-secondary'); removeSource.type = 'button';
  details.append(sourceTitle.wrap, sourceUrl.wrap, time.wrap, removeSource);
  const aiDetails = node('details', '', 'learning-ai'); aiDetails.hidden = true; aiDetails.append(node('summary', 'AI 补充（已选择的回答）'));
  const ai = field('AI 补充'); const aiInput = ai.input as HTMLTextAreaElement; aiInput.rows = 3;
  const removeAi = node('button', '移除 AI 补充', 'learning-secondary'); removeAi.type = 'button'; aiDetails.append(ai.wrap, removeAi);
  const replaceQuote = node('button', '改用本次选中的摘录', 'learning-secondary'); replaceQuote.type = 'button'; replaceQuote.hidden = true;
  const showQuote = () => { quoteBlock.hidden = false; };
  const syncQuote = () => { if (quoteInput.value.trim()) showQuote(); };
  const addQuote = node('button', '＋ 摘录', 'learning-secondary learning-add-quote'); addQuote.type = 'button';
  addQuote.title = '从页面选中文字后再点记笔记，或在这里手动添加'; addQuote.onclick = () => { showQuote(); quoteInput.focus(); };
  const highlightDetails = node('details', '', 'learning-more'); highlightDetails.append(node('summary', '从已有高亮选择摘录'));
  highlightDetails.hidden = !getHighlights;
  const highlightList = node('div'); highlightDetails.append(highlightList);
  highlightDetails.addEventListener('toggle', () => {
    if (!highlightDetails.open || busy || loading) return;
    highlightList.replaceChildren();
    // Read only saved highlights after an explicit action, never the article body.
    for (const html of getHighlights?.() || []) {
      const inert = new DOMParser().parseFromString(html, 'text/html');
      inert.querySelectorAll('script,style').forEach(element => element.remove());
      const text = inert.body.textContent?.trim(); if (!text) continue;
      const choice = node('button', text, 'learning-highlight-choice'); choice.type = 'button';
      choice.onclick = () => { if (busy || loading) return; quoteInput.value = text; timeInput.value = ''; showQuote(); updateChip(); pendingQuote = ''; replaceQuote.hidden = true; void persist(); };
      highlightList.append(choice);
    }
    if (!highlightList.childElementCount) highlightList.append(node('p', '此来源暂无高亮'));
  });
  const uriDetails = node('details', '', 'learning-uri'); uriDetails.hidden = true;
  uriDetails.append(node('summary', '通过 Obsidian 打开（实际写入未验证）'));
  const uriVault = field('Obsidian 库名', 'input'); const uriVaultInput = uriVault.input as HTMLInputElement;
  const dispatch = node('button', '发送到 Obsidian（未验证）', 'learning-secondary'); dispatch.type = 'button';
  uriDetails.append(node('p', '需明确输入库名；日期与路径由 Obsidian 解析，无法在这里确认写入。'), uriVault.wrap, dispatch);
  const tools = node('div', '', 'learning-tools'); tools.append(addQuote);
  // Where the note will land: one quiet line, shown in the footer next to the save button.
  const targetLine = node('p', '正在确认今日日记位置…', 'learning-target'); targetLine.setAttribute('role', 'status');
  const footer = node('footer'); const retryTarget = node('button', '重新确认目标', 'learning-secondary'); retryTarget.type = 'button';
  const save = node('button', '保存到日记', 'learning-primary'); save.type = 'submit'; save.disabled = true; save.title = '保存（⌘/Ctrl + Enter）';
  const destination = node('div', '', 'learning-destination'); destination.append(targetLine, retryTarget);
  footer.append(destination, save);
  const notice = node('div', '', 'learning-save-notice'); notice.hidden = true; notice.setAttribute('role','status'); doc.body.append(notice);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (message: string) => { notice.textContent = message; notice.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => {notice.hidden = true;}, 8000); };
  form.append(header, reflection.wrap, quoteBlock, replaceQuote, aiDetails, tools, highlightDetails, details, uriDetails, status, footer); dialog.append(form); doc.body.append(dialog);
  let draft: LearningRecordDraft | undefined, origin: LearningSource | undefined, target: DailyTargetResult = { status: 'unavailable' };
  let pendingQuote = '', pendingTime: number | undefined, busy = false, loading = false, generation = 0, writeQueue = Promise.resolve(), lastTime: number | undefined;
  let timedFrameSrc = '', targetLoading = false;
  let returnFocus: HTMLElement | null = null;
  const hasContent = () => Boolean(reflectionInput.value.trim() || quoteInput.value.trim() || aiInput.value.trim());
  const updateChip = () => {
    const raw = timeInput.value, seconds = Number(raw);
    timeChip.hidden = raw === '' || time.wrap.hidden || !Number.isFinite(seconds) || seconds < 0;
    if (!timeChip.hidden) timeChip.replaceChildren(createElement(Play), doc.createTextNode(clockLabel(seconds)));
  };
  const updateButtons = () => { save.disabled = !draft || busy || loading || targetLoading || target.status !== 'ready' || !hasContent(); dispatch.disabled = busy || loading || !hasContent() || !uriVaultInput.value.trim(); };
  const collect = () => {
    if (!draft) return;
    draft.reflection = reflectionInput.value; draft.quote = quoteInput.value; draft.aiSupplement = aiInput.value || undefined;
    draft.source = { title: titleInput.value, url: urlInput.value || undefined, kind: origin?.kind };
    if (timeInput.value !== '') draft.source.timestampSeconds = Number(timeInput.value);
    updateButtons();
  };
  const persist = () => {
    collect(); if (!draft || !origin) return writeQueue;
    const snapshot = JSON.parse(JSON.stringify(draft)) as LearningRecordDraft, source = { ...origin };
    writeQueue = writeQueue.then(() => service.persistLearningDraft(snapshot, source)).catch(() => { status.textContent = '草稿暂时未能保存到本机，请先保留输入内容'; });
    return writeQueue;
  };
  const paintDraft = () => {
    if (!draft) return;
    reflectionInput.value = draft.reflection; quoteInput.value = draft.quote; aiInput.value = draft.aiSupplement || '';
    titleInput.value = draft.source.title; urlInput.value = draft.source.url || ''; timeInput.value = draft.source.timestampSeconds === undefined ? '' : String(Math.floor(draft.source.timestampSeconds));
    aiDetails.hidden = !aiInput.value; time.wrap.hidden = draft.source.kind !== 'youtube' && draft.source.kind !== 'bilibili';
    quoteBlock.hidden = !quoteInput.value.trim(); updateChip(); updateButtons();
  };
  const paintTarget = () => {
    targetLine.textContent = target.status === 'ready' ? '→ ' + target.relativePath + ' · ' + target.vault : (target.error || '尚未确认库与今日日记位置，请检查本地保存助手与日记配置');
    targetLine.classList.toggle('is-problem', target.status !== 'ready'); retryTarget.hidden = target.status === 'ready';
    uriDetails.hidden = target.status !== 'unavailable'; updateButtons();
  };
  const refreshTarget = async () => {
    const current = generation; targetLoading = true; targetLine.textContent = '正在确认今日日记位置…'; updateButtons();
    try { const fresh = await service.getDailyTarget(); if (current !== generation) return; target = fresh; }
    catch { if (current === generation) target = {status:'unavailable',error:'日记目标确认失败，请重试'}; }
    finally { if (current === generation) { targetLoading = false; paintTarget(); } }
  };
  const show = () => { if (!dialog.open) { if (typeof dialog.show === 'function') dialog.show(); else dialog.setAttribute('open', ''); } };
  const close = () => { if (!loading && !busy) void persist(); ++generation; if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); returnFocus?.focus({ preventScroll: true }); };
  const enabled = () => generalSettings.learningNotes !== false;
  const open = async (entry: LearningEntry = {}) => {
    if (!enabled()) return;
    if (busy) { notify('上一条记录正在保存，请稍候重试'); return; }
    if (dialog.open) {
      if (entry.quote && draft && !loading) {
        // The card is non-modal, so a new selection can arrive while it is open: fill an empty excerpt, otherwise offer it.
        const at = learningTimestamp(doc);
        if (!quoteInput.value.trim()) { quoteInput.value = entry.quote; if (at !== undefined && time.wrap.hidden === false && timeInput.value === '') timeInput.value = String(Math.floor(at)); showQuote(); updateChip(); void persist(); }
        else if (entry.quote !== quoteInput.value) { pendingQuote = entry.quote; pendingTime = at; replaceQuote.hidden = false; }
      }
      if (entry.aiSupplement && draft) { aiInput.value = [aiInput.value, entry.aiSupplement].filter(Boolean).join('\n\n'); aiDetails.hidden = false; aiDetails.open = true; void persist(); }
      reflectionInput.focus(); return;
    }
    const selectedTime = learningTimestamp(doc);
    returnFocus = doc.activeElement as HTMLElement; show(); loading = true; busy = false; status.textContent = ''; pendingQuote = ''; replaceQuote.hidden = true;
    draft = undefined; origin = { ...getSource() };
    target = {status:'unavailable'}; targetLoading = false; targetLine.textContent = '正在确认今日日记位置…';
    for (const input of Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'))) input.value = '';
    details.open = false; quoteBlock.hidden = true; timeChip.hidden = true; highlightDetails.open = false; highlightList.replaceChildren(); highlightDetails.hidden = !getHighlights; aiDetails.hidden = true; aiDetails.open = false; uriDetails.hidden = true;
    updateButtons();
    if (youtubeVideoId(origin.url || '') || bilibiliVideo(origin.url || '')) {
      origin.kind = youtubeVideoId(origin.url || '') ? 'youtube' : 'bilibili';
      // Selected line first, then the playhead YouTube reports, then the line that is currently highlighted.
      origin.timestampSeconds = selectedTime ?? (doc.querySelector<HTMLIFrameElement>('article iframe')?.src === timedFrameSrc ? lastTime : undefined) ?? activeSegmentTime(doc) ?? options.getTime?.();
    }
    else origin.kind = origin.url ? 'web' : 'thought';
    const current = ++generation;
    for (const input of Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'))) input.disabled = true;
    try {
      await writeQueue; if (current !== generation) return;
      const [restored, fresh] = await Promise.all([service.loadLearningDraft(origin), service.getDailyTarget()]);
      if (current !== generation) return;
      draft = restored || service.createLearningDraft(origin, entry); target = fresh;
      if (restored && entry.quote && entry.quote !== restored.quote) { pendingQuote = entry.quote; pendingTime = origin.timestampSeconds; replaceQuote.hidden = false; }
      if (restored && entry.aiSupplement) draft.aiSupplement = [draft.aiSupplement, entry.aiSupplement].filter(Boolean).join('\n\n');
      paintDraft(); paintTarget(); status.textContent = restored ? '已恢复此来源的草稿' : '';
      if (entry.aiSupplement) { aiDetails.hidden = false; aiDetails.open = true; }
    } catch { status.textContent = '草稿或日记目标读取失败，请关闭后重试'; }
    finally {
      if (current !== generation) return;
      loading = false; for (const input of Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'))) input.disabled = false;
      updateButtons(); reflectionInput.focus();
    }
  };
  const submit = async (uri = false) => {
    if (busy || loading || !draft || !hasContent() || (!uri && (targetLoading || target.status !== 'ready'))) return;
    collect(); busy = true; updateButtons(); for (const input of Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'))) input.disabled = true;
    status.textContent = uri ? '正在发送…' : '正在写入…';
    try {
      await persist(); const snapshot = JSON.parse(JSON.stringify(draft)) as LearningRecordDraft;
      const result = uri ? await service.dispatchLearningRecord(snapshot, uriVaultInput.value.trim()) : await service.saveLearningRecord(snapshot, target);
      if (result.target) { target = result.target; paintTarget(); }
      if (result.status === 'saved') {
        if (draft.source.timestampSeconds !== undefined && origin?.url) { const text = draft.reflection.trim() || draft.quote.trim() || draft.aiSupplement || ''; await addMark(origin.url, { t: draft.source.timestampSeconds, text, at: draft.createdAt }); doc.dispatchEvent(new CustomEvent(MARKS_EVENT)); }
        status.textContent = '已写入 ' + result.vault + ' · ' + result.date + (result.error ? '；' + result.error : '');
        notify(status.textContent);
        // Core clears only the saved capture. A new entry must get a fresh ID.
        draft = undefined; if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); returnFocus?.focus({ preventScroll: true });
      } else if (result.status === 'dispatched') status.textContent = '已发送到 Obsidian，实际写入未验证；草稿保留，请在 Obsidian 核对';
      else status.textContent = result.error || (result.status === 'unconfirmed' ? '可能已写入，请保留同一记录重试核对' : '尚未写入，草稿已保留');
    } catch { status.textContent = '保存响应中断，请保留同一草稿重试，不要重复发送'; }
    finally { busy = false; for (const input of Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'))) input.disabled = false; updateButtons(); }
  };
  form.addEventListener('input', () => { updateChip(); if (!busy && !loading) void persist(); });
  timeChip.onclick = () => { details.open = true; timeInput.focus(); };
  removeQuote.onclick = () => { if (busy || loading) return; quoteInput.value = ''; quoteBlock.hidden = true; pendingQuote = ''; replaceQuote.hidden = true; void persist(); reflectionInput.focus(); };
  form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
  form.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); void submit(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); closeButton.onclick = close;
  retryTarget.onclick = () => { if (!busy && !loading) void refreshTarget(); }; dispatch.onclick = () => { void submit(true); };
  removeSource.onclick = () => { if (busy || loading) return; titleInput.value = ''; urlInput.value = ''; timeInput.value = ''; updateChip(); void persist(); };
  removeAi.onclick = () => { if (busy || loading) return; aiInput.value = ''; aiDetails.hidden = true; void persist(); };
  replaceQuote.onclick = () => { if (busy || loading) return; quoteInput.value = pendingQuote; timeInput.value = pendingTime === undefined ? '' : String(Math.floor(pendingTime)); pendingQuote = ''; pendingTime = undefined; replaceQuote.hidden = true; showQuote(); updateChip(); void persist(); };
  button.onclick = () => { void open({ quote: learningSelection(doc) }); };
  const onMessage = (event: MessageEvent) => {
    const iframe = doc.querySelector<HTMLIFrameElement>('article iframe[src*="youtube.com/embed/"]');
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== new URL(iframe.src).origin) return;
    try { const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; const seconds = data?.info?.currentTime; if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) { lastTime = seconds; timedFrameSrc = iframe.src; } } catch { /* unrelated messages */ }
  };
  // One key, no modifier: capture while watching without reaching for the mouse. Ignored while typing.
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'n') return;
    const target = event.target as HTMLElement | null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || target.closest?.('dialog[open]'))) return;
    if (options.singleKey === false || !enabled() || !doc.querySelector('article')) return;
    event.preventDefault(); void open({ quote: learningSelection(doc) });
  };
  doc.addEventListener('keydown', onKey);
  doc.defaultView?.addEventListener('message', onMessage);
  // Show where notes were taken on the transcript; it may load after this card, so watch the article too.
  let marksTimer: ReturnType<typeof setTimeout> | undefined, marksFor = '';
  const refreshMarks = async () => {
    const url = getSource().url || ''; const marks = await loadMarks(url); const article = doc.querySelector('article');
    if (article) renderMarks(article, marks); marksFor = url;
  };
  const scheduleMarks = () => { clearTimeout(marksTimer); marksTimer = setTimeout(() => { void refreshMarks(); }, 120); };
  doc.addEventListener(MARKS_EVENT, scheduleMarks);
  const marksObserver = typeof MutationObserver !== 'undefined' && doc.querySelector('article') ? new MutationObserver(scheduleMarks) : undefined;
  marksObserver?.observe(doc.querySelector('article')!, { childList: true });
  scheduleMarks();
  const controller = { button, open, updateSource: (next: () => LearningSource, highlights?: () => string[]) => { getSource = next; if (highlights) getHighlights = highlights; scheduleMarks(); }, dispose: () => { doc.removeEventListener('keydown', onKey); doc.removeEventListener(MARKS_EVENT, scheduleMarks); marksObserver?.disconnect(); clearTimeout(marksTimer); doc.defaultView?.removeEventListener('message', onMessage); clearTimeout(noticeTimer); notice.remove(); dialog.remove(); button.remove(); mounts.delete(doc); } };
  button.hidden = !enabled(); // the setting is read when the page opens
  mounts.set(doc, controller); return controller;
}
