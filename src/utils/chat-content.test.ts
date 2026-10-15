import { expect, it, vi } from 'vitest';
import { streamChat } from './chat-llm';
import { generalSettings } from './storage-utils';
import { validChatTurns, MAX_CHAT_IMAGE_PARTS } from './chat-content';
import { responsesRequest } from './oauth/accounts';
const image = { dataUrl:'data:image/png;base64,aGVsbG8=', label:'图 2' };
const messages = [{ role:'user' as const, content:'读图', images:[image] }];
const model = {id:'m',name:'Flash',providerId:'p',providerModelId:'glm-5.3-flash',enabled:true};
const response = (event: unknown) => new Response(`data: ${JSON.stringify(event)}\n`);

it.each([
 ['OpenAI', 'https://api.example/v1/chat/completions', {choices:[{delta:{content:'ok'}}]}, (body:any) => expect(body.messages[1].content[2]).toEqual({type:'image_url',image_url:{url:image.dataUrl}})],
 ['Anthropic','https://api.example/v1/messages',{type:'content_block_delta',delta:{text:'ok'}},(body:any) => expect(body.messages[0].content[2]).toEqual({type:'image',source:{type:'base64',media_type:'image/png',data:'aGVsbG8='}})],
 ['Gemini','https://generativelanguage.googleapis.com',{candidates:[{content:{parts:[{text:'ok'}]}}]},(body:any) => expect(body.contents[0].parts[2]).toEqual({inlineData:{mimeType:'image/png',data:'aGVsbG8='}})],
 ['Responses','https://api.example/v1/responses',{type:'response.output_text.delta',delta:'ok'},(body:any) => expect(body.input[0].content[2]).toEqual({type:'input_image',image_url:image.dataUrl,detail:'auto'})],
])('sends actual images with the %s protocol', async (name, baseUrl, event, check) => {
 generalSettings.providers = [{id:'p',name,baseUrl,apiKey:'fixture',apiKeyRequired:true}] as any;
 const fetch = vi.fn().mockResolvedValue(response(event)); vi.stubGlobal('fetch',fetch);
 try {
  expect(await streamChat({model,system:'s',messages,onDelta:()=>{}})).toBe('ok');
  const body = JSON.parse(fetch.mock.calls[0][1].body); (check as Function)(body);
  expect(JSON.stringify(body)).not.toContain('"images"');
 } finally { vi.unstubAllGlobals(); }
});

it('sends base64 images to Ollama with their numbered labels', async () => {
 generalSettings.providers = [{id:'p',name:'Ollama',baseUrl:'http://localhost:11434/api/chat',apiKey:'',apiKeyRequired:false}] as any;
 const fetch = vi.fn().mockResolvedValue(new Response('{"message":{"content":"ok"}}\n')); vi.stubGlobal('fetch',fetch);
 try {
  await streamChat({model,system:'s',messages,onDelta:()=>{}});
  const message = JSON.parse(fetch.mock.calls[0][1].body).messages[1];
  expect(message.images).toEqual(['aGVsbG8=']); expect(message.content).toContain('图 2');
 } finally { vi.unstubAllGlobals(); }
});

it('preserves images in Codex OAuth Responses and never includes source cookies', () => {
 const result = responsesRequest({kind:'codex',access:'fixture',accountId:'account',expires:Date.now()+999999} as any, model, 's', messages);
 expect(JSON.parse(result.init.body as string).input[0].content[2]).toMatchObject({type:'input_image',image_url:image.dataUrl});
 expect(result.init.credentials).toBe('omit'); expect(result.init.headers).not.toHaveProperty('Cookie');
});

it('validates raster bytes, role, total budget, and image count before sending', () => {
 expect(validChatTurns(messages)).toBe(true);
 expect(validChatTurns([{...messages[0],role:'assistant'}])).toBe(false);
 expect(validChatTurns([{...messages[0],images:[{...image,dataUrl:'https://private/image'}]}])).toBe(false);
 expect(validChatTurns([{...messages[0],images:[{...image,dataUrl:'data:image/svg+xml;base64,YQ=='}]}])).toBe(false);
 expect(validChatTurns([{...messages[0],images:Array(MAX_CHAT_IMAGE_PARTS+1).fill(image)}])).toBe(false);
});

it('never silently retries an image-rejecting service as text-only', async () => {
 generalSettings.providers = [{id:'p',name:'OpenAI',baseUrl:'https://api.example/v1',apiKey:'',apiKeyRequired:false}] as any;
 const fetch = vi.fn().mockResolvedValue(new Response('image input not supported',{status:400})); vi.stubGlobal('fetch',fetch);
 try { await expect(streamChat({model,system:'s',messages,onDelta:()=>{}})).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1); }
 finally { vi.unstubAllGlobals(); }
});
