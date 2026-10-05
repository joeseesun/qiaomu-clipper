import { createElement, WandSparkles } from 'lucide';
import { mountClipChat } from './clip-chat';
import { learningNotes } from './learning-composer';
import { loadSettings } from './storage-utils';
import { youtubeVideoId } from './youtube-url';
import { bilibiliEmbedUrl, bilibiliVideo, TRANSCRIPT_SELECTOR, PLAYER_SELECTOR } from './video-source';
import { mountPlayerSize } from './youtube-player-size';
import { mountPlayerMode } from './youtube-player-mode';
import { mountTranslation } from './youtube-translation';
import { createLanguagePicker } from './language-picker';
import { transcribeBrowserAudio, loadBrowserWhisper, chunksToPanelSegments, formatSrt, type BrowserWhisperResult } from './browser-whisper';
import { canCapturePageAudio, capturePageAudio, type CapturedAudioWindow } from './page-audio-capture';
import { translationLanguages } from './translation-languages';

// Read only transcript segments, excluding chapter headings and reader controls.
export function transcriptText(article: HTMLElement): string {
	const selectors = `${TRANSCRIPT_SELECTOR}:not([data-source="${WHISPER_SOURCE}"]) .transcript-segment, .youtube-whisper-live .transcript-segment`;
	return Array.from(article.querySelectorAll(selectors)).map(segment => {
		const timestamp = segment.querySelector('strong')?.textContent?.trim() || '';
		const clone = segment.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('.transcript-translation').forEach(node => node.remove());
		clone.querySelector('strong')?.remove();
		const text = clone.textContent?.replace(/^\s*·\s*/, '').replace(/\s+/g, ' ').trim() || '';
		return text ? `${timestamp ? `[${timestamp}] ` : ''}${text}` : '';
	}).filter(Boolean).join('\n');
}

const WHISPER_SOURCE = 'browser-whisper';
const whisperControls = new WeakMap<HTMLElement, { row: HTMLElement; status: HTMLElement; live: HTMLElement }>();

function mountBrowserWhisper(article: HTMLElement, controls: HTMLElement, studyStatus: HTMLElement, existingTranscript?: HTMLElement): void {
	const previous = whisperControls.get(article);
	if (previous) {
		controls.append(previous.row);
		studyStatus.after(previous.status);
		const anchor = existingTranscript?.isConnected ? existingTranscript : article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
		if (!previous.live.isConnected) { if (anchor) anchor.after(previous.live); else controls.after(previous.live); }
		return;
	}
	const doc = article.ownerDocument;
	const status = doc.createElement('span'); status.className = 'youtube-study-status youtube-whisper-status'; status.setAttribute('role', 'status');
	studyStatus.after(status);
	const row = doc.createElement('span'); row.className = 'youtube-whisper-controls';
	const label = doc.createElement('span'); label.className = 'youtube-whisper-label'; label.textContent = '浏览器 Whisper';
	const picker = createLanguagePicker(doc, {
		options: [{ code: 'auto', label: '自动检测' }, ...translationLanguages],
		value: 'auto', ariaLabel: '转录语言',
	});
	const choose = doc.createElement('button'); choose.type = 'button'; choose.className = 'youtube-whisper-start'; choose.textContent = '选择音频并自动转录';
	choose.title = '在浏览器本地运行 Whisper 转录音频'; choose.setAttribute('aria-label', choose.title);
	const input = doc.createElement('input'); input.type = 'file'; input.accept = 'audio/*,video/*'; input.hidden = true; input.tabIndex = -1;
	const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'youtube-whisper-retry'; retry.textContent = '重试'; retry.hidden = true;
	const download = doc.createElement('button'); download.type = 'button'; download.className = 'youtube-whisper-download'; download.textContent = '下载 SRT'; download.hidden = true;
	const confirm = doc.createElement('button'); confirm.type = 'button'; confirm.className = 'youtube-whisper-confirm'; confirm.textContent = '确认字幕'; confirm.hidden = true;
	const discard = doc.createElement('button'); discard.type = 'button'; discard.className = 'youtube-whisper-discard'; discard.textContent = '丢弃'; discard.hidden = true;
	const live = doc.createElement('div'); live.className = 'youtube-whisper-live transcript'; live.setAttribute('aria-live', 'polite'); live.hidden = true;
	const page = doc.createElement('button'); page.type = 'button'; page.className = 'youtube-whisper-page'; page.textContent = '转录页面音频';
	page.title = '选择当前学习页标签页并共享声音，从播放位置开始转录';
	page.hidden = !canCapturePageAudio();
	const stop = doc.createElement('button'); stop.type = 'button'; stop.className = 'youtube-whisper-stop'; stop.textContent = '停止'; stop.hidden = true;
	row.append(label, picker.element, page, choose, stop, retry, confirm, discard, download, input);
	controls.append(row);
	const insertion = existingTranscript?.isConnected ? existingTranscript : article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
	if (insertion) insertion.after(live); else row.after(live);
	whisperControls.set(article, { row, status, live });

	let selected: File | undefined;
	let result: BrowserWhisperResult | undefined;
	let controller: AbortController | undefined;
	let busy = false;
	let generation = 0;
	let capture: { stop: () => void } | undefined;
	let capturing = false, draining = false, captureFailed = false;
	let queue: CapturedAudioWindow[] = [];
	let loaded: Awaited<ReturnType<typeof loadBrowserWhisper>> | undefined;
	let language: string | undefined;
	let pendingResult: BrowserWhisperResult | undefined;
	const setBusy = (value: boolean) => {
		busy = value; choose.disabled = value; page.disabled = value;
		picker.select.disabled = value; picker.button.disabled = value; picker.close();
		stop.hidden = !value;
	};
	const sourceClass = article.dataset.videoPlatform === 'bilibili' ? 'bilibili' : 'youtube';
	const setStatus = (message: string) => { status.textContent = message; };
	const replaceTranscript = (next: BrowserWhisperResult) => {
		let local = article.querySelector<HTMLElement>(`${TRANSCRIPT_SELECTOR}[data-source="${WHISPER_SOURCE}"]`);
		if (!local) {
			local = doc.createElement('div'); local.className = `${sourceClass} transcript`; local.dataset.source = WHISPER_SOURCE;
			const heading = doc.createElement('h2'); heading.textContent = '浏览器 Whisper 转录'; local.append(heading);
			const anchor = existingTranscript?.isConnected ? existingTranscript : article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
			if (anchor) anchor.after(local); else article.append(local);
		} else {
			local.querySelectorAll('.transcript-segment').forEach(node => node.remove());
		}
		local.dataset.sourceLanguage = picker.select.value === 'auto' ? '' : picker.select.value;
		for (const segment of next.segments) {
			const line = doc.createElement('p'); line.className = 'transcript-segment'; line.dataset.source = WHISPER_SOURCE;
			const strong = doc.createElement('strong');
			const timestamp = doc.createElement('span'); timestamp.className = 'timestamp'; timestamp.textContent = segment.time;
			timestamp.dataset.timestamp = String(segment.time.split(':').reduce((total, part) => total * 60 + Number(part), 0));
			strong.append(timestamp);
			const text = doc.createElement('span'); text.className = 'transcript-segment-text'; text.textContent = segment.text;
			line.append(strong, text); local.append(line);
		}
	};
	const clearPending = () => { pendingResult = undefined; confirm.hidden = true; discard.hidden = true; };
	const showPending = (next: BrowserWhisperResult) => {
		pendingResult = next; confirm.hidden = false; discard.hidden = false;
		live.replaceChildren(); live.hidden = !next.segments.length;
		const heading = doc.createElement('h2'); heading.textContent = '实时识别字幕'; live.append(heading);
		for (const segment of next.segments) {
			const line = doc.createElement('p'); line.className = 'transcript-segment';
			const time = doc.createElement('strong'); time.textContent = segment.time;
			const text = doc.createElement('span'); text.className = 'transcript-segment-text'; text.textContent = segment.text;
			line.append(time, text); live.append(line);
		}
		setStatus(`已识别 ${next.segments.length} 段，确认后可复制、下载、剪藏和翻译`);
	};
	const renderCaptured = (next: BrowserWhisperResult, window: CapturedAudioWindow) => {
		const end = window.start + window.duration * window.rate;
		const chunks = [
			...(result?.chunks || []).filter(chunk => (chunk.timestamp[0] || 0) < window.start || (chunk.timestamp[0] || 0) >= end),
			...next.chunks.map(chunk => ({
				text: chunk.text,
				timestamp: [
					window.start + Math.min(window.duration, chunk.timestamp[0] || 0) * window.rate,
					window.start + Math.min(window.duration, chunk.timestamp[1] ?? window.duration) * window.rate,
				] as [number, number],
			})),
		].sort((a, b) => (a.timestamp[0] || 0) - (b.timestamp[0] || 0));
		result = { ...next, chunks, segments: chunksToPanelSegments(chunks), text: chunks.map(chunk => chunk.text).join(' ') };
		showPending(result); download.hidden = !chunks.length;
	};
	const drain = async () => {
		if (draining || captureFailed || !controller) return;
		draining = true; const current = generation;
		try {
			while (queue.length && current === generation) {
				const window = queue[0];
				loaded ??= await loadBrowserWhisper({ signal: controller.signal, onProgress: progress => setStatus(progress.status || '正在加载 Whisper 模型…') });
				const next = await transcribeBrowserAudio(window.audio, {
					...loaded, language, signal: controller.signal,
					onProgress: () => setStatus(`正在转录页面音频，等待处理 ${queue.length} 段…`),
				});
				if (current !== generation) return;
				renderCaptured(next, window); queue.shift();
			}
		} catch (error) {
			if (current !== generation) return;
			if (controller.signal.aborted) { queue = []; return; }
			captureFailed = true; capturing = false; capture?.stop(); capture = undefined;
			setStatus(error instanceof Error ? error.message : '页面音频转录失败'); retry.hidden = false;
		} finally {
			draining = false;
			if (current === generation && !capturing) {
				setBusy(false);
				if (!captureFailed) setStatus(`已停止页面转录：${result?.segments.length || 0} 段`);
			}
		}
	};
	const run = async () => {
		if (!selected || busy) return;
		captureFailed = false; queue = [];
		setBusy(true); retry.hidden = true;
		controller?.abort(); controller = new AbortController(); const current = ++generation;
		setStatus('正在加载 Whisper 模型…');
		try {
			result = await transcribeBrowserAudio(selected, {
				// Transformers.js Whisper accepts the model language code (for example
				// `zh`), while the shared Reader picker keeps regional UI codes.
				language: picker.select.value === 'auto' ? undefined : picker.select.value.split('-')[0],
				signal: controller.signal,
				onProgress: progress => {
					if (current !== generation) return;
					if (progress.phase === 'model') setStatus(progress.status || '正在加载 Whisper 模型…');
					else setStatus(progress.status || '正在转录音频…');
				},
			});
			if (current !== generation) return;
			if (!result.segments.length) throw new Error('没有识别到语音，请选择更清晰的音频后重试');
			showPending(result);
			download.hidden = false;
		} catch (error) {
			if (current !== generation || (error instanceof DOMException && error.name === 'AbortError')) return;
			setStatus(error instanceof Error ? error.message : '浏览器 Whisper 转录失败，请重试'); retry.hidden = false;
		} finally {
			if (current === generation) {
				setBusy(false);
				if (controller?.signal.aborted) setStatus('已取消转录');
			}
		}
	};
	page.addEventListener('click', () => {
		if (busy) return;
		setBusy(true); retry.hidden = true;
		controller?.abort(); controller = new AbortController(); const current = ++generation;
		captureFailed = false; capturing = true; selected = undefined; queue = [];
		language = picker.select.value === 'auto' ? undefined : picker.select.value.split('-')[0];
		setStatus('请选择当前学习页标签页，并共享标签页声音');
		// Request capture before any await to preserve the click's user activation.
		void capturePageAudio(article, {
			signal: controller.signal,
				onWindow: window => {
					if (current !== generation) return;
					queue.push(window); void drain();
					// Keep the capture session alive when Whisper is slower than
					// playback. Drop the oldest unprocessed window instead of
					// stopping the shared tab stream and forcing a manual restart.
					if (queue.length > 3) { queue.splice(0, queue.length - 3); setStatus('识别稍有延迟，继续收听页面音频…'); }
			},
			onStatus: message => { if (current === generation && !draining && !captureFailed) setStatus(message); },
			onStop: () => {
				capturing = false;
				if (!draining) { setBusy(false); setStatus(`已停止页面转录：${result?.segments.length || 0} 段`); }
			},
		}).then(session => {
			if (current !== generation || !capturing) { session.stop(); return; }
			capture = session; setStatus('正在收听页面音频…');
		}).catch(error => {
			if (current !== generation) return;
			capturing = false; setBusy(false);
			setStatus(error?.name === 'AbortError' ? '已取消页面转录'
				: error?.name === 'NotAllowedError' ? '未共享音频，可再次点击“转录页面音频”'
				: error instanceof Error ? error.message : '无法读取页面音频');
		});
	});
	confirm.addEventListener('click', () => {
		if (!pendingResult) return;
		replaceTranscript(pendingResult); result = pendingResult; clearPending();
		article.querySelector('.youtube-translate-toggle.is-unavailable')?.remove();
		mountTranslation(article, controls, status);
		// The confirmed transcript is a new DOM node; re-run the reader wiring so
		// follow-scroll, timestamp seeking, and active-line highlighting attach to it.
		doc.dispatchEvent(new CustomEvent('qiaomu-reader-rewire-transcript'));
		doc.dispatchEvent(new CustomEvent('qiaomu-transcript-state', { detail: { ready: true } }));
		setStatus(`已确认字幕：${result.segments.length} 段`);
	});
	discard.addEventListener('click', () => { clearPending(); result = undefined; live.replaceChildren(); live.hidden = true; const local = article.querySelector<HTMLElement>(`${TRANSCRIPT_SELECTOR}[data-source="${WHISPER_SOURCE}"]`); local?.remove(); download.hidden = true; setStatus('已丢弃本次识别结果'); });
	stop.addEventListener('click', () => {
		if (capturing || capture) {
			capturing = false;
			if (capture) capture.stop(); else controller?.abort();
			capture = undefined;
			if (!draining && !queue.length) setBusy(false);
		} else {
			controller?.abort(); queue = []; setStatus('正在取消转录…');
		}
	});
	choose.addEventListener('click', () => { input.value = ''; input.click(); });
	input.addEventListener('change', () => { selected = input.files?.[0]; if (selected) { setStatus(`已选择 ${selected.name}，正在自动转录`); choose.textContent = '重新选择音频'; retry.hidden = true; void run(); } });
	retry.addEventListener('click', () => {
		if (captureFailed && queue.length) {
			captureFailed = false; retry.hidden = true; setBusy(true);
			controller = new AbortController(); ++generation; void drain();
		} else void run();
	});
	download.addEventListener('click', () => {
		if (!result) return;
		const url = URL.createObjectURL(new Blob([formatSrt(result.chunks)], { type: 'application/x-subrip;charset=utf-8' }));
		const link = doc.createElement('a'); link.href = url; link.download = 'browser-whisper.srt'; doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
	});
	const dispose = () => {
		++generation; controller?.abort(); capture?.stop(); queue = []; picker.destroy(); observer.disconnect(); live.remove();
		doc.defaultView?.removeEventListener('pagehide', dispose);
	};
	const observer = new MutationObserver(() => { if (!article.isConnected) dispose(); });
	observer.observe(doc.documentElement, { childList: true, subtree: true });
	doc.defaultView?.addEventListener('pagehide', dispose, { once: true });
}

export async function mountYouTubeStudy(doc: Document, article: HTMLElement, title: string, url: string, existingChat?: { toggle: () => boolean }): Promise<void> {
	article.dataset.videoPlatform = bilibiliVideo(url) || article.querySelector('iframe[src*="player.bilibili.com"]') ? 'bilibili' : 'youtube';
	mountPlayerSize(article);
	mountPlayerMode(article);
	doc.documentElement.classList.add('youtube-study');
	// No duplicate transcript action row: copy/download/AI live in the shared bar.
	const existingFeedback = article.querySelector<HTMLElement>('.youtube-study-feedback');
	const feedback = existingFeedback || doc.createElement('div'); feedback.className = 'youtube-study-feedback';
	const status = feedback.querySelector<HTMLElement>('.youtube-study-status') || doc.createElement('span');
	status.className = 'youtube-study-status'; status.setAttribute('role', 'status');
	if (!status.parentElement) feedback.append(status);
	const text = transcriptText(article);
	const transcript = article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
	if (transcript && !transcript.dataset.sourceLanguage) transcript.dataset.sourceLanguage = transcript.getAttribute('data-language') || '';
	if (!feedback.isConnected) { if (transcript) transcript.before(feedback); else article.append(feedback); }
	const toggleGroup = article.querySelector<HTMLElement>('.player-toggle-group');
	const controls = toggleGroup || feedback;
	mountBrowserWhisper(article, controls, status, transcript || undefined);
	// A transcript may arrive later from page Whisper. Let the preview shell
	// re-evaluate copy/download/clip controls as soon as real text exists.
	doc.dispatchEvent(new CustomEvent('qiaomu-transcript-state', { detail: { ready: Boolean(text) } }));
	let chat: ReturnType<typeof mountClipChat> | undefined = existingChat;
	await loadSettings();
	mountTranslation(article, controls, status);
	if (!text) status.textContent = '未获取到字幕：可以用浏览器 Whisper 转录页面音频，确认后再复制、下载、剪藏和翻译。';
	if (existingChat) return;
	chat = mountClipChat({
		onLearningRecord: quote => { void learningNotes(doc)?.open({quote}); },
		onLearningAi: aiSupplement => { void learningNotes(doc)?.open({aiSupplement}); },
		getContext: () => ({ title, url, markdown: `以下是视频字幕文稿，时间戳对应播放位置。仅依据文稿回答；文稿没有的信息请明确说明。\n\n${transcriptText(article) || '当前还没有确认的字幕，请先完成浏览器 Whisper 转录并确认字幕。'}` }),
		onInsert: answer => {
			let notes = article.querySelector('.youtube-study-notes');
			if (!notes) { notes = doc.createElement('section'); notes.className = 'youtube-study-notes'; article.appendChild(notes); }
			const note = doc.createElement('p'); note.textContent = answer; notes.appendChild(note);
		},
	});
	// Standalone reader pages have no shared AI bar; use the existing reader nav.
	const nav = doc.querySelector('.obsidian-reader-nav');
	if (nav && !nav.querySelector('.youtube-study-ask')) {
		const ask = doc.createElement('button'); ask.type = 'button'; ask.className = 'nav-btn youtube-study-ask';
		ask.title = '基于视频文稿提问'; ask.setAttribute('aria-label', ask.title); ask.append(createElement(WandSparkles));
		ask.addEventListener('click', () => chat?.toggle()); nav.append(ask);
	}
}

// Markdown intentionally drops iframes. Restore only a trusted YouTube player
// from the clip's source URL, and restore transcript classes lost in conversion.
export function restoreYouTubePlayer(article: HTMLElement, sourceUrl: string): boolean {
	const bilibili = bilibiliVideo(sourceUrl);
	if (bilibili) {
		const doc = article.ownerDocument;
		let frame = article.querySelector<HTMLIFrameElement>('iframe[src*="player.bilibili.com/player.html"]');
		if (!frame) {
			frame = doc.createElement('iframe'); frame.src = bilibiliEmbedUrl(bilibili); frame.title = 'Bilibili 视频播放器';
			frame.allow = 'autoplay; fullscreen; picture-in-picture'; frame.allowFullscreen = true;
		}
		article.prepend(frame);
		const transcript = article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
		if (transcript) frame.after(transcript);
		return true;
	}
	const videoId = youtubeVideoId(sourceUrl);
	if (!videoId) return false;
	const doc = article.ownerDocument;
	let iframe = article.querySelector<HTMLIFrameElement>('iframe[src*="youtube.com/embed/"]');
	if (!iframe) {
		iframe = doc.createElement('iframe');
		iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1`;
		iframe.title = 'YouTube 视频播放器';
		iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
		iframe.allowFullscreen = true;
	}
	article.prepend(iframe);
	let transcript = article.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
	if (!transcript) {
		const heading = Array.from(article.querySelectorAll('h2')).find(node => /^transcript$|^转写文稿$|^字幕$/i.test(node.textContent?.trim() || ''));
		if (heading) {
			transcript = doc.createElement('div'); transcript.className = 'youtube transcript';
			let sibling: Element | null = heading.nextElementSibling;
			transcript.appendChild(heading);
			while (sibling && sibling.tagName !== 'H2') {
				const next: Element | null = sibling.nextElementSibling;
				if (sibling.matches('p')) {
					const strong = sibling.querySelector('strong');
					const time = strong?.textContent?.trim() || '';
					if (/^(?:\d+:)?\d+:\d{2}$/.test(time)) {
						sibling.classList.add('transcript-segment');
						const stamp = doc.createElement('span'); stamp.className = 'timestamp'; stamp.textContent = time;
						stamp.setAttribute('data-timestamp', String(time.split(':').reduce((value, part) => value * 60 + Number(part), 0)));
						strong!.replaceChildren(stamp);
					}
				}
				transcript.appendChild(sibling); sibling = next;
			}
		}
	}
	if (transcript) iframe.after(transcript);
	return true;
}
