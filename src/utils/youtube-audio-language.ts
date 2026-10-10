import { languageBase } from './subtitle-language';

// YouTube can choose a dubbed audio track for the viewer's region. audioIsDefault
// describes that choice, not the original. Like yt-dlp, read the original marker
// on streaming formats, even when the format has no downloadable URL.
export function originalAudioLanguage(player: any): string | undefined {
	const formats = [...(Array.isArray(player?.streamingData?.formats) ? player.streamingData.formats : []), ...(Array.isArray(player?.streamingData?.adaptiveFormats) ? player.streamingData.adaptiveFormats : [])];
	const languages = new Set<string>();
	for (const format of formats) {
		const audio = format?.audioTrack;
		if (!audio || !/\b(original)\b|原始|原声|原聲|オリジナル/i.test(String(audio.displayName ?? ''))) continue;
		const code = String(audio.id ?? '').split('.')[0];
		if (/^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/i.test(code)) languages.add(languageBase(code));
	}
	return languages.size === 1 ? [...languages][0] : undefined;
}
