import { it, expect } from 'vitest';
import { englishVoice } from './english-speech';
const voice = (name: string, lang: string, localService = true) => ({ name, lang, localService }) as SpeechSynthesisVoice;
it('selects the installed standard regional voices instead of novelty or remote voices', () => {
	const voices = [voice('Boing', 'en-US'), voice('Google UK English', 'en-GB', false), voice('Fred', 'en-US'), voice('Samantha', 'en-US'), voice('Daniel', 'en-GB')];
	expect(englishVoice(voices, 'uk')?.name).toBe('Daniel'); expect(englishVoice(voices, 'us')?.name).toBe('Samantha');
});
it('never substitutes another accent or a remote provider for a missing local accent', () => {
	expect(englishVoice([voice('Samantha', 'en-US'), voice('Karen', 'en-AU'), voice('Google UK', 'en-GB', false)], 'uk')).toBeUndefined();
	expect(englishVoice([voice('Boing', 'en-US')], 'us')).toBeUndefined();
});
