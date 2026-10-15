// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
vi.mock('./browser-polyfill', () => ({ default: {} }));
import { xhsAddress, xhsNoteRoot, extractXhsNote, readXhsMedia, isXhsMedia, snapshotXhsPlayer, getXhsPageMedia } from './xiaohongshu';
import { webMediaAddress, currentWebMediaAddress } from './web-media-page';
import { siteOf } from './study-sites';
const id = '6abc2b40000000000a023366';
const url = `https://www.xiaohongshu.com/explore/${id}`;
const media = 'https://sns-video-bd.xhscdn.com/stream/1/fixture.mp4';
function doc(type = 'normal') {
 const d = new DOMParser().parseFromString(`<aside>推荐内容</aside><div class="note-detail-mask" note-id="${id}"><div id="noteContainer" data-type="${type}"><div class="author"><a class="username">作者</a></div><h1 id="detail-title">测试笔记</h1><div id="detail-desc">第一行\n第二行 #话题<img alt="[笑]" src="https://picasso-static.xiaohongshu.com/emoji.png"><script>bad()</script></div><div class="note-slider-img"><img src="https://sns-webpic-qc.xhscdn.com/a.webp"></div><div class="note-slider-img"><img src="https://sns-webpic-qc.xhscdn.com/a.webp"></div><div class="note-slider-img"><img src="https://sns-webpic-qc.xhscdn.com/b.webp"></div><div class="comments-container">评论噪音<img src="https://sns-avatar.xhscdn.com/avatar.png"></div></div></div>`, 'text/html');
 return d;
}
describe('Xiaohongshu notes', () => {
 it('normalizes detail routes, keeps only access parameters, rejects feeds and lookalikes', () => {
  expect(xhsAddress(url+'?xsec_token=token%3D&xsec_source=pc_feed&tracking=1#comments')).toBe(url+'?xsec_token=token%3D&xsec_source=pc_feed');
  expect(xhsAddress(`https://www.xiaohongshu.com/discovery/item/${id}`)).toBe(url);
  expect(webMediaAddress(url)).toBe(url);
  for (const bad of ['https://www.xiaohongshu.com/explore','https://www.xiaohongshu.com/user/profile/'+id,url.replace('.com','.com.evil.test'),url.replace('https:','http:'),url.replace('www.','user:pw@www.'),url+'/extra','https://xhslink.com/a/abc']) expect(xhsAddress(bad)).toBeNull();
 });
 it('clips only the current note, preserves line breaks and deduplicates carousel images', () => {
  const data=extractXhsNote(doc(),url)!;
  expect(data.title).toBe('测试笔记');expect(data.author).toBe('作者');
  expect(data.content).toContain('第一行');expect(data.content).toContain('第二行 #话题[笑]');expect(data.content).toContain('<br>');
  expect(data.content.match(/<img /g)).toHaveLength(2);
  for(const noise of ['评论噪音','推荐内容','bad()','avatar.png','<script']) expect(data.content).not.toContain(noise);
 });
 it('does not clip a stale modal or classify photo live-images as video', () => {
  const d=doc();const v=d.createElement('video');d.querySelector('#noteContainer')!.append(v);
  expect(xhsNoteRoot(d,url.replace(id,'111111111111111111111111'))).toBeUndefined();
  expect(()=>extractXhsNote(d,url.replace(id,'111111111111111111111111'))).toThrow();
  expect(readXhsMedia(d,url)).toBeUndefined();
  expect(currentWebMediaAddress(d,v,url)).toBeNull();
 });
 it('fails visibly while a note is loading instead of clipping the background feed', () => {
  const d=doc();d.querySelector('#noteContainer')!.innerHTML='<h1 id="detail-title">加载中标题</h1>';
  expect(()=>extractXhsNote(d,url)).toThrow();
 });
 it('restores carousel order instead of making the loop duplicate its first image', () => {
  const d=doc();const images=d.querySelectorAll('.note-slider-img');
  images[0].setAttribute('data-swiper-slide-index','8');images[1].setAttribute('data-swiper-slide-index','8');images[2].setAttribute('data-swiper-slide-index','0');
  const note=extractXhsNote(d,url)!;expect(note.image).toContain('/b.webp');expect(note.content.indexOf('/b.webp')).toBeLessThan(note.content.indexOf('/a.webp'));
 });
 it('hands off only the current video note and its CDN, without cookies', () => {
  const d=doc('video'), v=d.createElement('video');v.src=media;d.querySelector('#noteContainer')!.append(v);
  Object.defineProperty(v,'duration',{value:30});
  expect(readXhsMedia(d,url)).toMatchObject({ok:true,title:'测试笔记',author:'作者',mediaUrl:media,video:true,seconds:30});
  expect(currentWebMediaAddress(d,v,url)).toBe(url);
  const outside=d.createElement('video');outside.src=media;d.body.prepend(outside);
  expect(currentWebMediaAddress(d,outside,url)).toBeNull();
  expect(isXhsMedia(url,media)).toBe(true);
  for(const bad of ['blob:'+url,media.replace('https:','http:'),media.replace('xhscdn.com','xhscdn.com.evil.org'),media.replace('sns-video-bd','sns-avatar'),media.replace('sns-video-bd.','user:pw@sns-video-bd.'),media.replace('.com/','.com:8443/'),'https://127.0.0.1/a.mp4']) expect(isXhsMedia(url,bad),bad).toBe(false);
 });
 it('runs the injected snapshot without module closures, selects a combined MP4 and rejects stale/DRM notes', () => {
  const d=doc('video');d.querySelector('#noteContainer')!.append(d.createElement('video'));
  const stream={format:'mp4',audio_codec:'aac',master_url:media.replace('https:','http:'),size:123};
  const note:any={noteId:id,type:'video',title:'当前视频',user:{nickname:'作者'},video:{mediaV2:JSON.stringify({video:{duration:30},stream:{EF4:[stream],EF5:[{format:'fmp4',master_url:'https://sns-video-v3.xhscdn.com/a.m4s'}]}})}};
  const win={__INITIAL_STATE__:{note:{noteDetailMap:{[id]:{note}}}}};
  const injected=new Function('document','location','window',`return (${snapshotXhsPlayer.toString()})();`);
  expect(injected(d,{href:url},win)).toMatchObject({url,info:{mediaUrl:media,title:'当前视频',seconds:30}});
  note.noteId='111111111111111111111111';expect(injected(d,{href:url},win).info).toBeUndefined();note.noteId=id;
  note.video.mediaV2=JSON.stringify({video:{drm_type:1},stream:{EF4:[stream]}});expect(injected(d,{href:url},win).info).toBeUndefined();
 });
 it('recovers only another tab of this note and rejects a late response from the next note', async () => {
  const other=url.replace(id,'111111111111111111111111'),api={get:vi.fn(async()=>({url:other})),query:vi.fn(async()=>[{id:8,url:url+'?xsec_token=other'}])};
  const info={ok:true as const,title:'当前视频',author:'作者',site:'小红书',video:true,mediaUrl:media,seconds:30,thumbnail:null};
  const read=vi.fn(async()=>({url,info}));expect(await getXhsPageMedia(url,7,api,read)).toMatchObject(info);expect(read).toHaveBeenCalledWith(8);
  read.mockResolvedValue({url:other,info});expect(await getXhsPageMedia(url,7,api,read)).toBeUndefined();
  read.mockResolvedValue({url,info:{...info,mediaUrl:'https://evil.test/a.mp4'}});expect(await getXhsPageMedia(url,7,api,read)).toBeUndefined();
 });
 it('routes the actual reader message listener to the MAIN-world snapshot, never the TikTok or Douyin path', async () => {
  const source=fs.readFileSync(path.resolve(__dirname,'../background.ts'),'utf8');
  const tree=ts.createSourceFile('background.ts',source,ts.ScriptTarget.Latest,true);
  let callback:ts.Expression|undefined;
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(tree)==='browser.runtime.onMessage.addListener'&&node.arguments[0]?.getText(tree).includes("request?.action !== 'qiaomuWebStudySource'")) callback=node.arguments[0];ts.forEachChild(node,visit);};visit(tree);
  expect(callback).toBeDefined();
  const runtime={id:'extension',getURL:(p:string)=>'chrome-extension://extension/'+p};
  const info={ok:true as const,title:'视频',author:'作者',site:'小红书',video:true,mediaUrl:media,seconds:30,thumbnail:null};
  const api={runtime,tabs:{get:vi.fn(async()=>({url})),query:vi.fn(async()=>[])},scripting:{executeScript:vi.fn(async()=>[{result:{url,info}}])}};
  const fallback=vi.fn(),js=ts.transpileModule('const handler='+callback!.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const handler=new Function('browser','siteOf','getXhsPageMedia','snapshotXhsPlayer','getWebPageMedia',js+';return handler;')(api,siteOf,getXhsPageMedia,snapshotXhsPlayer,fallback);
  const request={action:'qiaomuWebStudySource',url,sourceTabId:7};
  expect(await handler(request,{id:'extension',url:runtime.getURL('reader.html?study=web')})).toMatchObject(info);
  expect(api.scripting.executeScript).toHaveBeenCalledWith({target:{tabId:7},world:'MAIN',func:snapshotXhsPlayer});expect(fallback).not.toHaveBeenCalled();
  api.scripting.executeScript.mockClear();expect(await handler(request,{id:'extension',url})).toBeNull();expect(api.scripting.executeScript).not.toHaveBeenCalled();
 });
});
