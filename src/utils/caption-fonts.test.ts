// @vitest-environment jsdom
import {expect,it,vi,afterEach} from 'vitest';
import {captionFontFamily,validCaptionFont,ensureCaptionFont} from './caption-fonts';
afterEach(()=>vi.unstubAllGlobals());
it('preserves concrete system font names and rejects CSS and unknown downloads',()=>{expect(validCaptionFont('local:苹方-简')).toBe(true);expect(captionFontFamily('local:苹方-简')).toContain('"苹方-简"');for(const name of ['local:evil";display:none','local:','open:unknown'])expect(validCaptionFont(name)).toBe(false);});
it('keeps system fonts offline and reports unsupported open font loading',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await ensureCaptionFont(document,'system');expect(fetch).not.toHaveBeenCalled();await expect(ensureCaptionFont(document,'open:wenkai')).rejects.toThrow();});
