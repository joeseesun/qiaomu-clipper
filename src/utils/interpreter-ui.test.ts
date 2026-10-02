// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { handleInterpreterUI } from './interpreter';
import { generalSettings } from './storage-utils';
import type { ModelConfig, Template } from '../types/types';

const model: ModelConfig = { id:'model', providerId:'provider', providerModelId:'test', name:'Test', enabled:true };
const template: Template = { id:'test', name:'test', behavior:'create', path:'Clippings', noteNameFormat:'Article', noteContentFormat:'{{"Summarize"}}', properties:[] };
let testTime = Date.now();
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(testTime += 120000);
 generalSettings.providers = [{id:'provider', name:'OpenAI', baseUrl:'https://example.com/v1/chat/completions', apiKeyRequired:false, apiKey:''}];
 document.body.innerHTML = `<div id="interpreter"><button id="interpret-btn"></button><div id="interpreter-error"></div><span id="interpreter-timer"></span><textarea id="prompt-context">Article</textarea></div><button id="clip-btn"></button><textarea id="note-content-field">{{"Summarize"}}</textarea>`;
 vi.spyOn(console,'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const run = () => handleInterpreterUI(template,{content:'Article'},1,'https://example.com',model);
const success = () => new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({prompts_responses:{prompt_1:'Summary'}})}}]}));

test('processes a draft without the removed dropdown button and unlocks saving', async () => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(success()));
 await run();
 expect((document.getElementById('note-content-field') as HTMLTextAreaElement).value).toBe('Summary');
 expect((document.getElementById('clip-btn') as HTMLButtonElement).disabled).toBe(false);
 expect(document.getElementById('interpret-btn')!.classList.contains('done')).toBe(true);
 expect(vi.getTimerCount()).toBe(0);
});

test('failure preserves the draft, stops the timer, and allows a successful retry', async () => {
 const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(success());
 vi.stubGlobal('fetch',fetchMock);
 await expect(run()).rejects.toThrow('Network unavailable');
 expect((document.getElementById('interpret-btn') as HTMLButtonElement).disabled).toBe(false);
 expect((document.getElementById('note-content-field') as HTMLTextAreaElement).value).toBe('{{"Summarize"}}');
 expect(vi.getTimerCount()).toBe(0);
 await run();
 expect(document.getElementById('interpret-btn')!.classList.contains('error')).toBe(false);
 expect((document.getElementById('note-content-field') as HTMLTextAreaElement).value).toBe('Summary');
});

test('does not release a save lock owned by the calling save operation', async () => {
 (document.getElementById('clip-btn') as HTMLButtonElement).disabled = true;
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(success()));
 await run();
 expect((document.getElementById('clip-btn') as HTMLButtonElement).disabled).toBe(true);
});
