// Exact regional voices only. Never label an American fallback as British, and
// avoid macOS novelty voices (bells, robots, singing) for language learning.
export function englishVoice(voices: SpeechSynthesisVoice[], accent: 'uk' | 'us'): SpeechSynthesisVoice | undefined {
	const locale = accent === 'uk' ? 'en-gb' : 'en-us';
	const ordinary = voices.filter(v => v.localService && v.lang.replace('_', '-').toLowerCase() === locale && !/^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Trinoids|Whisper|Wobble|Zarvox|Superstar)$/i.test(v.name));
	const preferred = accent === 'uk' ? ['Daniel', 'Serena', 'Kate', 'Oliver'] : ['Samantha', 'Alex', 'Tom', 'Ava', 'Allison'];
	return preferred.map(name => ordinary.find(v => v.name === name || v.name.startsWith(name + ' '))).find(Boolean) || ordinary[0];
}
