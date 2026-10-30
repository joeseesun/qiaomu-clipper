import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import * as shared from './shared';
const content=readFileSync('src/x-publish/x-content.ts','utf8');
const code=ts.transpileModule(content.slice(content.indexOf('async function runImport('),content.indexOf('\nif (!window.__qiaomuWriteXContent')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
it.each([{ok:true,base64:'',mime:'image/png'},{ok:true,base64:'YQ==',mime:undefined}])('rejects incomplete prepared data before creating or changing the X draft',async image=>{
 const fresh=vi.fn(),post=vi.fn();
 const args={describeXMediaMessage:(s:string)=>s,shared,Cancelled:Error,showCard:vi.fn(),isArticleRoute:()=>true,waitForMainReady:async()=>true,ensureFreshEditor:fresh,safeName:()=> 'fixture.png',window:{postMessage:vi.fn()},runMain:vi.fn(),articleIdFromUrl:()=>null,location:{href:'https://x.com/compose/articles'}};
 const run=new Function(...Object.keys(args),code+';return runImport;')(...Object.values(args));
 await run('---\ntitle: Fixture\n---\n\n![image](https://fixture/image.png)',new Map([['https://fixture/image.png',image]]),post,{cancel:false,controller:new AbortController()});
 expect(post).toHaveBeenCalledWith(expect.objectContaining({type:'error',error:expect.stringContaining('没能准备好')}));expect(fresh).not.toHaveBeenCalled();
});
it('hands mixed MP4/GIF/image files to the actual import plan without changing video MIME or order',async()=>{
 const runMain=vi.fn().mockResolvedValue({imgOk:3}),post=vi.fn(),fresh=vi.fn();
 const args={describeXMediaMessage:(s:string)=>s,shared,Cancelled:Error,showCard:vi.fn(),isArticleRoute:()=>true,waitForMainReady:async()=>true,ensureFreshEditor:fresh,safeName:(_n:string,_f:string,mime:string)=>mime==='video/mp4'?'clip.mp4':'picture.png',window:{postMessage:vi.fn()},runMain,articleIdFromUrl:()=> '42',location:{href:'https://x.com/compose/articles/edit/42'},t:(s:string)=>s};
 const run=new Function(...Object.keys(args),code+';return runImport;')(...Object.values(args));
 const sources=['https://fixture/photo.png','https://fixture/movie.mp4','https://fixture/animated.gif'];
 const prepared=new Map(sources.map((source,i)=>[source,{ok:true,base64:'YQ==',mime:['image/png','video/mp4','image/gif'][i],bytes:1}]));
 await run('---\ntitle: Fixture\n---\n\n![p]('+sources[0]+')\n\n[clip]('+sources[1]+')\n\n![g]('+sources[2]+')',prepared,post,{cancel:false,controller:new AbortController()});
 expect(fresh).toHaveBeenCalledOnce();expect(runMain).toHaveBeenCalledOnce();
 const [plan,files]=runMain.mock.calls[0];
 expect(plan.plan.map((p:any)=>p.op.file.mime)).toEqual(['image/png','video/mp4','image/gif']);
 expect([...files.values()].map((f:any)=>f.mime)).toEqual(['image/png','video/mp4','image/gif']);
 expect(post).toHaveBeenCalledWith(expect.objectContaining({type:'done'}));
});
