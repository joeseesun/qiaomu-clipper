import { getMessage } from './i18n';
import { bilibiliEmbedUrl, isBilibiliEmbed, PLAYER_SELECTOR, TRANSCRIPT_SELECTOR } from './video-source';
import { LAYOUT_EVENT } from './layout-event';
import { sourceTextNodes } from './transcript-format';
import { mountTranscriptSearch } from './transcript-search';
import { mountDownloadButton } from './download-button';
import { type DownloadChoice } from './media-download';
import { cookiesTxtFor } from './browser-cookies';
import browser from './browser-polyfill';

// CJK-aware text boundary helpers
const SENT_END = /[.!?。！？]/;
const SOFT_STOP = /[,、，]/;
const CJK_SENT_END = /[。！？]/;
const CJK_PUNCT = /[。！？、，]/;
const CJK_CHAR = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

// CJK punctuation doesn't require trailing whitespace
function isSentBoundary(text: string, punctPos: number, nextPos: number): boolean {
	const ch = text[punctPos];
	if (CJK_SENT_END.test(ch)) return true;
	if (/[.!?]/.test(ch)) return nextPos >= text.length || /\s/.test(text[nextPos]);
	return false;
}

function isSentOrSoftBoundary(text: string, punctPos: number, nextPos: number): boolean {
	const ch = text[punctPos];
	if (CJK_PUNCT.test(ch)) return true;
	if (/[.!?,]/.test(ch)) return nextPos >= text.length || /\s/.test(text[nextPos]);
	return false;
}

// In CJK text each character acts as its own word
function isWordStep(text: string, pos: number): boolean {
	if (CJK_CHAR.test(text[pos])) return true;
	if (pos > 0 && CJK_CHAR.test(text[pos - 1]) && !CJK_CHAR.test(text[pos]) && /\S/.test(text[pos])) return true;
	return false;
}

interface TranscriptSettings {
	pinPlayer: boolean;
	autoScroll: boolean;
	highlightActiveLine: boolean;
}

interface ScrollHelper {
	getStickyOffset: () => number;
	// Where the active line should rest after an automatic scroll; defaults to just below the sticky offset.
	getFocusOffset?: () => number;
	scrollTo: (targetY: number) => void;
	programmaticScroll: () => boolean;
}

const cleanups = new WeakMap<HTMLElement, () => void>();
export const unwireTranscript = (article: HTMLElement) => { cleanups.get(article)?.(); cleanups.delete(article); };

export function wireTranscript(
	doc: Document,
	article: HTMLElement,
	settings: TranscriptSettings,
	scroll: ScrollHelper,
	onSettingChange?: (key: keyof TranscriptSettings, value: boolean) => void
): void {
	const transcript = article.querySelector(TRANSCRIPT_SELECTOR) as HTMLElement | null;
	if (!transcript || transcript.dataset.readerWired === 'true') return;

	const iframe = article.querySelector(PLAYER_SELECTOR) as HTMLIFrameElement | null;
	const bilibili = !!iframe && isBilibiliEmbed(iframe.src);
	const videoWrapper = article.querySelector('.reader-video-wrapper') as HTMLElement | null;
	const videoEl = videoWrapper?.querySelector('video.reader-video-player') as HTMLVideoElement | null;
	const thumbnailLink = article.querySelector('a[href*="youtube.com/watch"]') as HTMLAnchorElement | null;
	const playerEl = (videoWrapper || iframe || thumbnailLink) as HTMLElement | null;
	if (!playerEl) return;

	unwireTranscript(article);
	const disposers: Array<() => void> = [];
	const listen = (target: EventTarget, type: string, handler: (event: any) => void, options?: boolean | AddEventListenerOptions) => {
		target.addEventListener(type, handler, options); disposers.push(() => target.removeEventListener(type, handler, options));
	};
	cleanups.set(article, () => { for (const dispose of disposers) dispose(); toggleGroup.remove(); toggleBar.remove(); currentPosButton.remove(); delete transcript.dataset.readerWired; });
	transcript.dataset.readerWired = 'true';
	// Reuse a pre-existing container when subtitles arrive after the live player.
	const playerContainer = playerEl.closest<HTMLElement>('.player-container') || doc.createElement('div');
	const pinDefault = settings.pinPlayer;
	const autoScrollDefault = settings.autoScroll;
	const highlightDefault = settings.highlightActiveLine;
	playerContainer.className = 'player-container' + (pinDefault ? ' pin-player' : '');
	if (!playerContainer.contains(playerEl)) {
		playerEl.parentNode!.insertBefore(playerContainer, playerEl);
		playerContainer.appendChild(playerEl);
	}

	let autoScrollEnabled = autoScrollDefault;
	let highlightEnabled = highlightDefault;

	const toggleBar = doc.createElement('div');
	toggleBar.className = 'player-toggles';

	// Floating "current position" button — appended to body,
	// shown only when the active segment is scrolled out of view
	const currentPosButton = doc.createElement('button');
	currentPosButton.className = 'player-current-pos';
	currentPosButton.textContent = getMessage('readerCurrentPosition');
	transcript.style.position = 'relative';
	transcript.appendChild(currentPosButton);

	const createToggle = (key: string, label: string, defaultOn: boolean, onChange: (on: boolean) => void) => {
		const wrapper = doc.createElement('label');
		wrapper.className = 'player-toggle' + (defaultOn ? ' is-enabled' : ''); wrapper.dataset.toggle = key;
		const toggle = doc.createElement('div'); toggle.className = 'player-toggle-switch';
		const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = defaultOn; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', label);
		toggle.appendChild(input);
		const text = doc.createElement('span'); text.textContent = label;
		wrapper.append(text, toggle);
		listen(input, 'change', () => { wrapper.classList.toggle('is-enabled', input.checked); onChange(input.checked); });
		return wrapper;
	};
	// Pin the video while reading (only meaningful when the video sits above the text) and follow the line being
	// played. The translation switch is added after these, so it stays the last one in the row.
	const pinToggle = createToggle('pin', getMessage('studyPinVideo'), pinDefault, on => {
		playerContainer.classList.toggle('pin-player', on);
		article.dispatchEvent(new CustomEvent(LAYOUT_EVENT)); // a pinned video in theater mode is sized to leave room for the text
		window.dispatchEvent(new CustomEvent('reader-show-nav'));
		onSettingChange?.('pinPlayer', on);
	});
	const autoScrollToggle = createToggle('follow', getMessage('studyScrollTranscript'), autoScrollDefault, on => {
		autoScrollEnabled = on;
		onSettingChange?.('autoScroll', on);
	});

	const toggleGroup = doc.createElement('div');
	toggleGroup.className = 'player-toggle-group is-open';
	toggleGroup.append(pinToggle, autoScrollToggle);

	toggleBar.appendChild(toggleGroup);

	playerContainer.appendChild(toggleBar);

	if (__LOCAL_EDITION__) {
		try {
			const pageUrl = window.location.href;
			const videoTitle = doc.querySelector('h1')?.textContent?.trim() || doc.title || '视频';
			const dlHost = doc.createElement('div');
			dlHost.className = 'qiaomu-dl-host';
			dlHost.style.cssText = 'margin-inline-start:auto;display:inline-flex;align-items:center;line-height:normal;';
			toggleBar.appendChild(dlHost);

			void (async () => {
				const cookiesApi = (browser as unknown as { cookies?: { getAll(details: { domain: string }): Promise<any[]> } }).cookies;
				const cookiesTxt = cookiesApi ? await cookiesTxtFor(pageUrl, details => cookiesApi.getAll(details)) : '';
				const choices: DownloadChoice[] = [
					{ id: 'video', label: getMessage('studyVideo') || '高清视频', url: pageUrl, kind: 'video', ext: 'mp4', source: 'native' },
					{ id: 'audio', label: getMessage('studyAudio') || '仅音频', url: pageUrl, kind: 'audio', ext: 'mp3', source: 'native' }
				];
				mountDownloadButton(dlHost, {
					title: videoTitle,
					choices,
					cookiesTxt,
					save: async () => {},
				});
			})();
		} catch (e) {
			console.warn('[qiaomu] failed to mount download button in reader:', e);
		}
	}

	if (iframe && !bilibili) {
		// Enable JS API on the embed
		const src = new URL(iframe.src);
		if (src.searchParams.get('enablejsapi') !== '1') {
			src.searchParams.set('enablejsapi', '1');
			src.searchParams.set('origin', window.location.origin);
			iframe.src = src.toString();
		}

		// Initialize postMessage connection once iframe loads
		listen(iframe, 'load', () => {
			if (iframe.contentWindow) {
				iframe.contentWindow.postMessage(JSON.stringify({
					event: 'listening'
				}), '*');
			}
		});
	}

	// Build a sorted list of segments with their start times
	const segments = Array.from(transcript.querySelectorAll('.transcript-segment')) as HTMLElement[];
	segments.forEach(seg => {
		// Pull the timestamp out into its own element
		// and wrap remaining text in a span
		const strong = seg.querySelector('strong');
		if (!strong) return;

		if (strong.nextSibling?.nodeType === Node.TEXT_NODE) {
			strong.nextSibling.textContent = strong.nextSibling.textContent!.replace(/^\s*·\s*/, '');
		}

		// Move timestamp strong out, wrap the rest in a div
		const textWrapper = doc.createElement('div');
		textWrapper.className = 'transcript-segment-text';
		strong.remove();
		while (seg.firstChild) {
			textWrapper.appendChild(seg.firstChild);
		}
		seg.appendChild(strong);
		seg.appendChild(textWrapper);
	});
	// Set timestamp column width to the widest timestamp
	let maxWidth = 0;
	segments.forEach(seg => {
		const strong = seg.querySelector('strong');
		if (strong) {
			maxWidth = Math.max(maxWidth, strong.getBoundingClientRect().width);
		}
	});
	transcript.style.setProperty('--timestamp-width', Math.ceil(maxWidth) + 'px');

	const segmentTimes = segments.map(seg => {
		const ts = seg.querySelector('.timestamp');
		return parseFloat(ts?.getAttribute('data-timestamp') || '0');
	});

	const FALLBACK_SEGMENT_DURATION = 30;
	const AUTO_SCROLL_COOLDOWN = 10000; // free scrolling: after ten quiet seconds the page returns to the playing line
	const getSegmentEnd = (i: number) =>
		Number(segments[i].querySelector('.timestamp')?.getAttribute('data-end')) > segmentTimes[i] ? Number(segments[i].querySelector('.timestamp')?.getAttribute('data-end')) : i < segmentTimes.length - 1 ? segmentTimes[i + 1] : segmentTimes[i] + FALLBACK_SEGMENT_DURATION;

	// Map each segment to its preceding chapter heading for outline tracking
	const segmentChapters: (Element | null)[] = [];
	const segmentIndexMap = new Map(segments.map((s, i) => [s, i]));
	let currentChapter: Element | null = null;
	const transcriptChildren = Array.from(transcript.children);
	for (const child of transcriptChildren) {
		if (/^H[2-6]$/.test(child.tagName)) {
			currentChapter = child;
		} else if (child.classList.contains('transcript-segment')) {
			const idx = segmentIndexMap.get(child as HTMLElement);
			if (idx !== undefined) segmentChapters[idx] = currentChapter;
		}
	}
	let activeChapter: Element | null = null;

	// Track active segment based on video current time
	let activeSegment: HTMLElement | null = null;

	listen(currentPosButton, 'click', () => {
		if (activeSegment) {
			const rect = activeSegment.getBoundingClientRect();
			const targetY = (window.pageYOffset || doc.documentElement.scrollTop)
				+ rect.top - (scroll.getFocusOffset?.() ?? scroll.getStickyOffset() + 20);
			scroll.scrollTo(targetY);
		}
	});
	let activeIndex = -1;
	let suppressScroll = false;
	let lastUserScroll = 0;
	let lastCurrentTime = -1;
	let scrubbing = false;
	let lastScrub = 0;

	let resumeTimer: ReturnType<typeof setTimeout> | undefined;
	disposers.push(() => clearTimeout(resumeTimer));
	listen(window, 'scroll', () => {
		if (scroll.programmaticScroll() || scrubbing) return;
		lastUserScroll = Date.now();
		// Do not wait for the next line to start: when the reader has been idle long enough, go back to the one playing.
		clearTimeout(resumeTimer);
		resumeTimer = setTimeout(() => {
			lastUserScroll = 0;
			if (!autoScrollEnabled || suppressScroll || search.active() || !activeSegment) return;
			const rect = activeSegment.getBoundingClientRect();
			scroll.scrollTo((window.pageYOffset || doc.documentElement.scrollTop) + rect.top - (scroll.getFocusOffset?.() ?? scroll.getStickyOffset() + 20));
		}, AUTO_SCROLL_COOLDOWN);
	}, { passive: true });

	const updateActiveSegment = (currentTime: number) => {
		if (Math.abs(currentTime - lastCurrentTime) < 0.05) return;
		lastCurrentTime = currentTime;
		let newIndex = -1;
		for (let i = segmentTimes.length - 1; i >= 0; i--) {
			if (currentTime >= segmentTimes[i]) {
				newIndex = i;
				break;
			}
		}
		if (newIndex !== activeIndex) {
			// Resume auto-scroll once segment changes after scrub ends
			if (suppressScroll && !scrubbing) {
				suppressScroll = false;
			}
			activeSegment?.classList.remove('is-active');
			if (newIndex >= 0) {
				segments[newIndex].classList.add('is-active');
				// Auto-scroll to keep active segment visible
				if (autoScrollEnabled && !suppressScroll && !search.active() && Date.now() - lastUserScroll > AUTO_SCROLL_COOLDOWN) {
					const rect = segments[newIndex].getBoundingClientRect();
					const targetY = (window.pageYOffset || doc.documentElement.scrollTop)
						+ rect.top - (scroll.getFocusOffset?.() ?? scroll.getStickyOffset() + 20);
					scroll.scrollTo(targetY);
				}
			}
			activeSegment = newIndex >= 0 ? segments[newIndex] : null;
			activeIndex = newIndex;

			// Update in-progress chapter in outline
			const chapter = newIndex >= 0 ? segmentChapters[newIndex] : null;
			if (chapter !== activeChapter) {
				if (activeChapter?.id) {
					doc.querySelector(`.obsidian-reader-outline-item[data-heading-id="${activeChapter.id}"]`)
						?.classList.remove('in-progress');
				}
				if (chapter?.id) {
					doc.querySelector(`.obsidian-reader-outline-item[data-heading-id="${chapter.id}"]`)
						?.classList.add('in-progress');
				}
				activeChapter = chapter;
			}
		}
		// Show floating button when active segment is out of view
		if (activeSegment) {
			const rect = activeSegment.getBoundingClientRect();
			const stickyOffset = scroll.getStickyOffset();
			const isVisible = rect.bottom > stickyOffset && rect.top < window.innerHeight;
			currentPosButton.classList.toggle('is-visible', !isVisible);
		} else {
			currentPosButton.classList.remove('is-visible');
		}
		// Update progress line on the scrub track
		if (activeSegment && activeIndex >= 0) {
			const segRect = activeSegment.getBoundingClientRect();
			const trackRect = scrubTrack.getBoundingClientRect();
			const start = segmentTimes[activeIndex];
			const end = getSegmentEnd(activeIndex);
			const segProgress = Math.min(1, Math.max(0, (currentTime - start) / (end - start)));
			const yInTrack = (segRect.top - trackRect.top) + segProgress * segRect.height;
			const trackProgress = yInTrack / trackRect.height;
			scrubTrack.style.setProperty('--track-progress', (trackProgress * 100) + '%');

			// Update playback highlight — underline the current line
			if (playbackHighlight && highlightEnabled) {
				playbackHighlight.clear();
				const textEl = activeSegment.querySelector('.transcript-segment-text');
				const textNodes = textEl ? sourceTextNodes(textEl) : [];
				let position = Math.max(0, Math.round(segProgress * textNodes.reduce((size, node) => size + node.length, 0)));
				let textNode: Text | undefined;
				for (let i = 0; i < textNodes.length; i++) {
					textNode = textNodes[i];
					if (position < textNode.length || i === textNodes.length - 1) break;
					position -= textNode.length;
				}
				if (textNode && textNode.length > 0) {
					const totalLen = (textNode.textContent || '').length;
					const charPos = Math.min(totalLen - 1, Math.max(0, position));

					// Find lines around the current position
					const probe = doc.createRange();
					const getLineY = (pos: number) => {
						probe.setStart(textNode!, Math.min(pos, totalLen - 1));
						probe.setEnd(textNode!, Math.min(pos + 1, totalLen));
						return probe.getClientRects()[0]?.top;
					};

					const lineY = getLineY(charPos);
					if (lineY === undefined) return;

					// Scan backward to find start of current sentence
					// but limit to ~2 lines back so run-ons don't over-highlight
					const text = textNode.textContent || '';
					let hlStart = 0;
					if (segProgress > 0.05) {
						hlStart = charPos;
						let backLineChanges = 0;
						let backLastY = lineY;
						while (hlStart > 0) {
							if (isSentBoundary(text, hlStart - 1, hlStart)) {
								while (hlStart < charPos && /\s/.test(text[hlStart])) hlStart++;
								break;
							}
							// Check line changes in steps to reduce layout queries
							if (hlStart % 8 === 0 || hlStart === 1) {
								const y = getLineY(hlStart - 1);
								if (y !== undefined && Math.abs(y - backLastY) > 2) {
									backLineChanges++;
									if (backLineChanges >= 2) break;
									backLastY = y;
								}
							}
							hlStart--;
						}
					}

					// Scan forward: up to 3 lines total, stop at sentence end or comma
					let hlEnd = charPos + 1;
					let fwdLines = 0;
					let fwdLastY = lineY;
					while (hlEnd < totalLen && fwdLines < 3) {
						// Check line changes in steps
						if (hlEnd % 8 === 0 || hlEnd === charPos + 1) {
							const y = getLineY(hlEnd);
							if (y === undefined) break;
							if (Math.abs(y - fwdLastY) > 2) {
								fwdLines++;
								if (fwdLines >= 3) break;
								fwdLastY = y;
							}
						}
						if (hlEnd > charPos + 1 && isSentOrSoftBoundary(text, hlEnd - 1, hlEnd)) break;
						hlEnd++;
					}

					const range = doc.createRange();
					range.setStart(textNode, hlStart);
					range.setEnd(textNode, hlEnd);
					playbackHighlight.add(range);
				}
			}
		}
	};

	// Set up time tracking and seeking based on player type
	let seekTo: (seconds: number) => void;
	let iframePlaying = false;

	if (videoEl) {
		// Native video element: use HTML5 API directly
		seekTo = (seconds: number) => {
			videoEl.currentTime = seconds;
		};
		listen(videoEl, 'timeupdate', () => {
			updateActiveSegment(videoEl.currentTime);
		});
		// Prevent native video controls from handling seek shortcuts
		listen(videoEl, 'keydown', (e) => {
			if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyJ' || e.code === 'KeyL') {
				e.preventDefault();
			}
		});
	} else if (iframe && bilibili) {
		// Bilibili's embed has no player API. When this extension's script inside the embed answers (bilibili-embed-content.ts), it
		// reports the time and takes a seek, so the transcript follows playback and a jump does not reload the player. Until it
		// answers (or where it cannot run), a jump reloads the embed at the requested second and the transcript marks the clicked
		// line itself; a scrub drag is coalesced into one reload.
		let pending: ReturnType<typeof setTimeout> | undefined, bridged = false;
		disposers.push(() => clearTimeout(pending));
		const onBridge = (e: MessageEvent) => {
			if (e.source !== iframe.contentWindow) return;
			const data = e.data as { qiaomuPlayer?: string; time?: unknown; paused?: unknown } | null;
			if (data?.qiaomuPlayer !== 'time' || typeof data.time !== 'number') return;
			bridged = true; iframePlaying = data.paused === false; updateActiveSegment(data.time);
		};
		listen(window, 'message', onBridge);
		const post = (message: Record<string, unknown>) => iframe.contentWindow?.postMessage({ qiaomuPlayer: message.qiaomuPlayer, ...message }, 'https://player.bilibili.com');
		seekTo = (seconds: number) => {
			const target = Math.max(0, seconds);
			if (bridged) { updateActiveSegment(target); post({ qiaomuPlayer: 'seek', time: target, play: true }); return; }
			const whole = Math.floor(target);
			updateActiveSegment(whole);
			clearTimeout(pending);
			pending = setTimeout(() => {
				if (bridged) { post({ qiaomuPlayer: 'seek', time: target, play: true }); return; }
				const url = new URL(iframe.src);
				url.searchParams.set('t', String(whole)); url.searchParams.set('autoplay', '1');
				iframe.src = url.toString();
			}, 250);
		};
	} else if (iframe) {
		// Iframe embed: use postMessage API
		seekTo = (seconds: number) => {
			if (!iframe.contentWindow) return;
			iframe.contentWindow.postMessage(JSON.stringify({
				event: 'command',
				func: 'seekTo',
				args: [seconds, true]
			}), '*');
		};

		const onMessage = (e: MessageEvent) => {
			if (e.source !== iframe.contentWindow) return;
			try {
				const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
				if (data?.info?.currentTime !== undefined) {
					updateActiveSegment(data.info.currentTime);
				}
				if (data?.info?.playerState !== undefined) {
					iframePlaying = data.info.playerState === 1;
				}
			} catch {} // Ignore non-YouTube postMessage events
		};
		listen(window, 'message', onMessage);

		const poll = setInterval(() => {
			if (!iframe.contentWindow || !iframe.isConnected) {
				clearInterval(poll);
				window.removeEventListener('message', onMessage);
				return;
			}
			iframe.contentWindow.postMessage(JSON.stringify({
				event: 'command',
				func: 'getCurrentTime',
				args: []
			}), '*');
		}, 500);
		disposers.push(() => clearInterval(poll));
	} else {
		seekTo = () => {};
	}

	// Keyboard shortcuts for video playback
	const togglePlayPause = () => {
		if (videoEl) {
			videoEl.paused ? videoEl.play() : videoEl.pause();
		} else if (iframe?.contentWindow && bilibili) {
			iframe.contentWindow.postMessage({ qiaomuPlayer: 'toggle' }, 'https://player.bilibili.com');
		} else if (iframe?.contentWindow && !bilibili) {
			iframe.contentWindow.postMessage(JSON.stringify({
				event: 'command',
				func: iframePlaying ? 'pauseVideo' : 'playVideo',
				args: []
			}), '*');
		}
	};

	const seekRelative = (delta: number) => {
		if (videoEl) {
			videoEl.currentTime = Math.max(0, videoEl.currentTime + delta);
		} else if (iframe?.contentWindow) {
			seekTo(Math.max(0, lastCurrentTime + delta));
		}
	};

	// Use capture phase so we intercept before YouTube's own keyboard
	// handlers on the page — the original page scripts are still running
	listen(doc, 'keydown', (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select, button, a, [contenteditable], [role=slider], [role=switch], .clip-chat')) return;

		switch (e.code) {
			case 'Space':
				// Only handle Space for iframe embeds — native video
				// controls handle Space themselves and would double-toggle
				if (!videoEl) {
					e.preventDefault();
					e.stopImmediatePropagation();
					togglePlayPause();
				}
				break;
			case 'KeyK':
				// K is not a native video shortcut, so handle it for both
				e.preventDefault();
				e.stopImmediatePropagation();
				togglePlayPause();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				e.stopImmediatePropagation();
				seekRelative(-5);
				break;
			case 'ArrowRight':
				e.preventDefault();
				e.stopImmediatePropagation();
				seekRelative(5);
				break;
			case 'KeyJ':
				e.preventDefault();
				e.stopImmediatePropagation();
				seekRelative(-10);
				break;
			case 'KeyL':
				e.preventDefault();
				e.stopImmediatePropagation();
				seekRelative(10);
				break;
		}
	}, { capture: true });

	// YouTube handles Space on keyup — block that too
	listen(doc, 'keyup', (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.code === 'Space' && !videoEl) {
			const target = e.target as HTMLElement;
			if (target.closest('input, textarea, select, button, a, [contenteditable], [role=slider], [role=switch], .clip-chat')) return;
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}, { capture: true });

	// Add a scrub track behind the timestamps
	const scrubTrack = doc.createElement('div');
	scrubTrack.className = 'transcript-scrub-track';
	const scrubHover = doc.createElement('div');
	scrubHover.className = 'transcript-scrub-hover';
	scrubTrack.appendChild(scrubHover);
	transcript.style.position = 'relative';
	transcript.appendChild(scrubTrack);

	// Search box above the lines. While a search is active the list is filtered, so following playback pauses.
	const search = mountTranscriptSearch(doc, transcript, segments, { placeholder: getMessage('transcriptSearch'), clear: getMessage('transcriptSearchClear'), noMatch: getMessage('transcriptSearchNone') });

	// Word highlights using CSS Custom Highlight API
	const hasHighlights = !!(CSS as any).highlights;
	const playbackHighlight = hasHighlights ? new (window as any).Highlight() : null;
	const hoverHighlight = hasHighlights ? new (window as any).Highlight() : null;
	if (hasHighlights) {
		(CSS as any).highlights.set('transcript-playback', playbackHighlight);
		(CSS as any).highlights.set('transcript-hover', hoverHighlight);
	}

	const getCaretNode = (x: number, y: number): { node: Node; offset: number } | null => {
		if ('caretPositionFromPoint' in doc) {
			const pos = (doc as any).caretPositionFromPoint(x, y);
			if (pos) return { node: pos.offsetNode, offset: pos.offset };
		} else if ('caretRangeFromPoint' in doc) {
			const range = (doc as any).caretRangeFromPoint(x, y) as Range | null;
			if (range) return { node: range.startContainer, offset: range.startOffset };
		}
		return null;
	};

	const getHoverRange = (textNode: Node, offset: number): Range | null => {
		const text = textNode.textContent || '';
		const totalWords = 8;

		// Forward first: up to 6 words, stop at sentence boundary
		// Commas act as soft stops — prefer stopping at a comma if we have 4+ words
		let end = offset;
		let wordsForward = 0;
		let lastComma = -1;
		let wordsAtComma = 0;
		while (end < text.length && wordsForward < 6) {
			if (isSentBoundary(text, end - 1, end)) break;
			if (SOFT_STOP.test(text[end - 1]) && wordsForward >= 3) {
				lastComma = end;
				wordsAtComma = wordsForward;
			}
			end++;
			if (end < text.length && ((/\s/.test(text[end - 1]) && /\S/.test(text[end])) || isWordStep(text, end))) wordsForward++;
		}
		// Prefer comma stop if we went past it
		if (lastComma > 0 && wordsForward > wordsAtComma) {
			end = lastComma;
			wordsForward = wordsAtComma;
		}

		// Backward: if forward hit punctuation, limit to 2 words back
		const hitPunctuation = end < text.length && SENT_END.test(text[end - 1]);
		const maxBack = hitPunctuation ? 2 : Math.max(1, totalWords - wordsForward);
		let start = offset;
		let wordsBack = 0;
		while (start > 0 && wordsBack < maxBack) {
			if (isSentBoundary(text, start - 1, start)) break;
			start--;
			if (start > 0 && ((/\s/.test(text[start]) && /\S/.test(text[start - 1])) || isWordStep(text, start))) wordsBack++;
		}

		// Trim whitespace at edges
		while (start < offset && /\s/.test(text[start])) start++;
		while (end > offset && /\s/.test(text[end - 1])) end--;
		if (start >= end) return null;
		const range = doc.createRange();
		range.setStart(textNode, start);
		range.setEnd(textNode, end);
		return range;
	};

	const updateHoverHighlight = (e: MouseEvent) => {
		if (!hoverHighlight) return;
		hoverHighlight.clear();
		const seg = (e.target as HTMLElement).closest('.transcript-segment-text');
		if (!seg || (e.target as HTMLElement).closest('.transcript-translation')) return;
		const caret = getCaretNode(e.clientX, e.clientY);
		if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !seg.contains(caret.node)) return;
		const range = getHoverRange(caret.node, caret.offset);
		if (range) hoverHighlight.add(range);
	};

	listen(transcript, 'mousemove', (e: MouseEvent) => {
		const rect = scrubTrack.getBoundingClientRect();
		scrubHover.style.top = (e.clientY - rect.top) + 'px';
		updateHoverHighlight(e);
	});
	listen(transcript, 'mouseleave', () => {
		scrubHover.style.top = '';
		if (hoverHighlight) hoverHighlight.clear();
	});
	// Position from first segment to bottom
	const positionTrack = () => {
		const transcriptRect = transcript.getBoundingClientRect();
		const firstSegRect = segments[0].getBoundingClientRect();
		scrubTrack.style.top = (firstSegRect.top - transcriptRect.top) + 'px';
	};
	positionTrack();

	const getTimeFromY = (clientY: number): number => {
		// Find which segment the Y position falls within
		for (let i = segments.length - 1; i >= 0; i--) {
			const rect = segments[i].getBoundingClientRect();
			if (clientY >= rect.top) {
				const progress = Math.min(1, (clientY - rect.top) / rect.height);
				const start = segmentTimes[i];
				const end = getSegmentEnd(i);
				return start + progress * (end - start);
			}
		}
		return segmentTimes[0] || 0;
	};

	listen(scrubTrack, 'mousedown', (e) => {
		scrubbing = true;
		suppressScroll = true;
		seekTo(getTimeFromY(e.clientY));
		e.preventDefault();
	});

	listen(window, 'mousemove', (e) => {
		if (!scrubbing) return;
		const now = Date.now();
		if (now - lastScrub < 100) return;
		lastScrub = now;
		seekTo(getTimeFromY(e.clientY));
	});

	listen(window, 'mouseup', () => {
		scrubbing = false;
	});

	// Click anywhere in a segment to seek to that position
	listen(transcript, 'click', (e: MouseEvent) => {
		// Don't seek if highlighter is active or user was selecting text
		if (doc.body.classList.contains('obsidian-highlighter-active')) return;
		const selection = window.getSelection();
		if (selection && selection.toString().length > 0) return;

		const seg = (e.target as HTMLElement).closest('.transcript-segment') as HTMLElement | null;
		if (!seg) return;
		const idx = segments.indexOf(seg);
		if (idx < 0) return;

		const start = segmentTimes[idx];
		if ((e.target as HTMLElement).closest('strong, .timestamp')) { seekTo(start); return; }
		const end = getSegmentEnd(idx);
		if ((e.target as HTMLElement).closest('.transcript-translation')) { seekTo(start); return; }

		// Use caret position to estimate character-level progress
		const textEl = seg.querySelector('.transcript-segment-text');
		if (textEl) {
			const textNodes = sourceTextNodes(textEl);
			const totalLen = textNodes.reduce((size, node) => size + node.length, 0);
			if (totalLen > 0) {
				const caret = getCaretNode(e.clientX, e.clientY);
				let charOffset = totalLen;
				if (caret && caret.node.nodeType === Node.TEXT_NODE && textEl.contains(caret.node)) {
					charOffset = 0;
					for (const node of textNodes) {
						if (node === caret.node) { charOffset += caret.offset; break; }
						charOffset += node.length;
					}
				}
				const progress = Math.min(1, Math.max(0, charOffset / totalLen));
				seekTo(start + progress * (end - start));
				return;
			}
		}

		// Fallback to Y position
		const rect = seg.getBoundingClientRect();
		const progress = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
		seekTo(start + progress * (end - start));
	});
}
