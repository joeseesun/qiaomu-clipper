// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import * as heading from './transcript-heading';

afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); vi.restoreAllMocks(); });

it.each([
 [56, 300, 324, 24], // At rest, cover only the heading margin inside the transcript.
 [56, 60, 56, 0], // Never paint above the transcript into preceding generation controls.
 [56, 40, 56, 16], // Partly stuck: cover only content that has reached the heading.
 [56, -200, 56, 56],
 [420, 390, 420, 30], // A pinned player must not hide preceding controls either.
])('bounds the sticky backdrop to transcript content (%i, %i, %i)', (offset, transcriptTop, headingTop, expected) => {
 const transcript = document.createElement('div'); transcript.className = 'transcript'; document.body.append(transcript);
 const tools = heading.transcriptHeadingTools(transcript), row = tools.parentElement!;
 row.style.top = `${offset}px`;
 vi.spyOn(transcript, 'getBoundingClientRect').mockReturnValue({top: transcriptTop} as DOMRect);
 vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({top: headingTop} as DOMRect);
 heading.syncTranscriptHeadingCover(transcript);
 expect(transcript.style.getPropertyValue('--transcript-heading-cover')).toBe(`${expected}px`);
 expect(getComputedStyle(row).position).toBe('sticky');
});

it('uses the bounded backdrop rather than the full sticky offset', () => {
 const transcript = document.createElement('div'); document.body.append(transcript); heading.transcriptHeadingTools(transcript);
 expect(document.getElementById('transcript-heading-style')!.textContent).toContain('height:var(--transcript-heading-cover,0px)');
});
