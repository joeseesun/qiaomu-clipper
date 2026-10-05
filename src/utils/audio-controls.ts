// The audio player of study mode, drawn here instead of with the browser's own controls so it looks like the rest of the page and
// has what a listener reaches for: play, a timeline, jumps back and forward, and speed. The media element underneath stays the
// one the transcript follows. The chosen speed is remembered.
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const KEY = 'qiaomuAudioRate';
const load = (): number => { try { const value = Number(localStorage.getItem(KEY)); return SPEEDS.includes(value) ? value : 1; } catch { return 1; } };
const save = (value: number) => { try { localStorage.setItem(KEY, String(value)); } catch { /* storage unavailable */ } };
export const speedLabel = (value: number) => `${value}×`;
export const clock = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const whole = Math.floor(seconds), h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
	return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
export interface AudioLabels { play: string; pause: string; back: string; forward: string; speed: string; seek: string }

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">';
const ICON = {
	play: `${SVG}<path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>`,
	pause: `${SVG}<rect fill="currentColor" x="6" y="5" width="4.5" height="14" rx="1.3"/><rect fill="currentColor" x="13.5" y="5" width="4.5" height="14" rx="1.3"/></svg>`,
	back: `${SVG}<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></g><text x="12" y="15.4" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor">15</text></svg>`,
	forward: `${SVG}<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g><text x="12" y="15.4" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor">30</text></svg>`,
};

export function mountAudioControls(doc: Document, media: HTMLMediaElement, labels: AudioLabels): HTMLElement {
	const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] => { const item = doc.createElement(tag); if (className) item.className = className; return item; };
	const icon = (button: HTMLElement, svg: string) => { button.innerHTML = svg; };
	const tool = (className: string, svg: string, label: string, action: () => void) => { const button = make('button', className); button.type = 'button'; icon(button, svg); button.title = label; button.setAttribute('aria-label', label); button.addEventListener('click', action); return button; };
	const root = make('div', 'qa-player');
	const play = tool('qa-play', ICON.play, labels.play, () => { if (media.paused) void Promise.resolve(media.play()).catch(() => {}); else media.pause(); });
	const now = make('span', 'qa-time'), total = make('span', 'qa-time qa-total'), seek = make('input', 'qa-seek'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '1'; seek.value = '0'; seek.setAttribute('aria-label', labels.seek);
	const line = make('div', 'qa-line'); line.append(now, seek, total);
	const main = make('div', 'qa-main'); main.append(play, line);
	// Speed is a small menu rather than a button that cycles blindly: the viewer sees what the choices are.
	let rate = load(); media.playbackRate = rate; media.defaultPlaybackRate = rate;
	const speedWrap = make('div', 'qa-speed'), speed = make('button', 'qa-chip'); speed.type = 'button'; speed.title = labels.speed; speed.setAttribute('aria-label', labels.speed); speed.setAttribute('aria-haspopup', 'menu'); speed.setAttribute('aria-expanded', 'false');
	const menu = make('div', 'qa-menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
	const items = SPEEDS.map(value => { const item = make('button', 'qa-menu-item'); item.type = 'button'; item.setAttribute('role', 'menuitemradio'); item.dataset.rate = String(value); item.textContent = speedLabel(value); item.addEventListener('click', () => { apply(value); closeMenu(); speed.focus(); }); return item; });
	menu.append(...items); speedWrap.append(speed, menu);
	const paintRate = () => { speed.textContent = speedLabel(rate); items.forEach(item => item.setAttribute('aria-checked', String(Number(item.dataset.rate) === rate))); };
	const apply = (value: number) => { rate = value; media.playbackRate = value; media.defaultPlaybackRate = value; save(value); paintRate(); };
	const closeMenu = () => { menu.hidden = true; speed.setAttribute('aria-expanded', 'false'); doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', onKey, true); };
	const outside = (event: Event) => { if (!speedWrap.contains(event.target as Node)) closeMenu(); };
	const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeMenu(); speed.focus(); } };
	speed.addEventListener('click', () => {
		if (!menu.hidden) { closeMenu(); return; }
		menu.hidden = false; speed.setAttribute('aria-expanded', 'true'); doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', onKey, true); items.find(item => Number(item.dataset.rate) === rate)?.focus();
	});
	paintRate();
	const tools = make('div', 'qa-tools');
	tools.append(tool('qa-skip', ICON.back, labels.back, () => { media.currentTime = Math.max(0, media.currentTime - 15); }), tool('qa-skip', ICON.forward, labels.forward, () => { media.currentTime = Math.min(media.duration || Infinity, media.currentTime + 30); }), speedWrap);
	root.append(main, tools);

	// Follow the media; while the viewer drags the timeline the position is theirs.
	let dragging = false;
	const paint = () => {
		const duration = Number.isFinite(media.duration) ? media.duration : 0, at = dragging ? Number(seek.value) : media.currentTime;
		seek.max = String(Math.floor(duration)); if (!dragging) seek.value = String(Math.floor(media.currentTime));
		seek.style.setProperty('--p', duration ? `${Math.min(100, at / duration * 100)}%` : '0%'); seek.setAttribute('aria-valuetext', `${clock(at)} / ${clock(duration)}`);
		now.textContent = clock(at); total.textContent = clock(duration);
		const playing = !media.paused; if (play.dataset.state !== String(playing)) { play.dataset.state = String(playing); icon(play, playing ? ICON.pause : ICON.play); play.title = playing ? labels.pause : labels.play; play.setAttribute('aria-label', play.title); }
	};
	for (const type of ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'playing', 'pause', 'ended', 'seeked']) media.addEventListener(type, paint);
	// A speed chosen with the browser's own means (a key, an extension) is followed, and a source loaded later starts at it.
	media.addEventListener('ratechange', () => { if (SPEEDS.includes(media.playbackRate) && media.playbackRate !== rate) { rate = media.playbackRate; media.defaultPlaybackRate = rate; save(rate); paintRate(); } });
	seek.addEventListener('input', () => { dragging = true; paint(); });
	seek.addEventListener('change', () => { media.currentTime = Number(seek.value); dragging = false; paint(); });
	paint();
	return root;
}
