import { expect, it } from 'vitest';
import { originalAudioLanguage } from './youtube-audio-language';
import { tracksOf, trackInfos } from './youtube-captions';
import { chooseTrack } from './subtitle-language';
const audio = (id: string, displayName: string, audioIsDefault = false) => ({audioTrack: {id, displayName, audioIsDefault}});
it('finds original audio independently of default dub and format URL availability', () => {
 expect(originalAudioLanguage({streamingData:{adaptiveFormats:[audio('ar.4','Arabic',true),audio('en-US.0','English (original)')]}})).toBe('en');
 expect(originalAudioLanguage({streamingData:{formats:[audio('fr.0','French (original)')]}})).toBe('fr');
});
it('does not call the account default audio original or guess conflicting metadata', () => {
 expect(originalAudioLanguage({streamingData:{adaptiveFormats:[audio('ar.4','Arabic',true)]}})).toBeUndefined();
 expect(originalAudioLanguage({streamingData:{adaptiveFormats:[audio('en.0','English (original)'),audio('fr.0','French (original)')]}})).toBeUndefined();
 expect(originalAudioLanguage({streamingData:{formats:'invalid'}})).toBeUndefined();
});
it('passes original audio metadata through the fallback caption listing', () => {
 const player={streamingData:{adaptiveFormats:[audio('fr.0','French (original)')]},captions:{playerCaptionsTracklistRenderer:{captionTracks:[
  {baseUrl:'https://www.youtube.com/api/timedtext?lang=ar',languageCode:'ar',kind:'asr'},
  {baseUrl:'https://www.youtube.com/api/timedtext?lang=fr',languageCode:'fr',kind:'asr'},
  {baseUrl:'https://www.youtube.com/api/timedtext?lang=zh',languageCode:'zh'}
 ]}}};
 expect(chooseTrack(trackInfos(tracksOf(player)))?.language).toBe('fr');
});
it('does not label a translated caption URL as original audio', () => {
 const tracks=trackInfos([{baseUrl:'https://www.youtube.com/api/timedtext?lang=en&tlang=fr',languageCode:'fr',kind:'asr'}],true,'fr');
 expect(tracks[0].original).toBe(false);
});
