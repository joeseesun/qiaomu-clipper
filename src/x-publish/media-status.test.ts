import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('src/x-publish/main-world.js', 'utf8');
function helpers() {
 const start=source.indexOf('  function existingMediaEntities('),end=source.indexOf('  function placeSelectionAtMarker(',start);
 return new Function(source.slice(start,end)+';return {mediaIdFromEntityData,findNewMediaUpload};')();
}
function content(type:string,data:unknown) {
 const block={getType:()=> 'atomic',findEntityRanges:(_test:unknown,visit:any)=>visit(0),getCharacterList:()=>({get:()=>({getEntity:()=> 'new'})})};
 return {getBlockMap:()=>new Map([['video-block',block]]),getEntity:()=>({getType:()=>type,getData:()=>data})};
}
it('recognizes a video entity with committed media data, including Map-backed values',()=>{
 const {findNewMediaUpload}=helpers();
 const found=findNewMediaUpload(content('VIDEO',new Map([['mediaItems',[new Map<string,unknown>([['media_id_string','2112743253263155200'],['processing_info',{state:'succeeded'}]])]]])),new Set());
 expect(found).toMatchObject({blockKey:'video-block',mediaId:'2112743253263155200',state:'ready'});
});
it('does not mistake video duration, dimensions or progress for an uploaded media ID',()=>{
 expect(helpers().mediaIdFromEntityData({video_info:{duration_millis:12000},width:1920,progress_percent:100})).toBeNull();
});
it.each(['pending','in_progress'])('waits for GIF processing %s even when a media ID already exists',state=>{
 const found=helpers().findNewMediaUpload(content('MEDIA',{media_id_string:'2112743253263155200',processing_info:{state,progress_percent:60}}),new Set());
 expect(found).toMatchObject({state:'processing',progress:60});
});
it('surfaces a processing failure instead of waiting for the timeout',()=>{
 expect(helpers().findNewMediaUpload(content('MEDIA',{media_id_string:'2112743253263155200',processing_info:{state:'failed',error:{message:'Unsupported codec'}}}),new Set())).toMatchObject({state:'failed',error:'Unsupported codec'});
});
it('does not accept an unrelated atomic block or a local blob preview as upload completion',()=>{
 expect(helpers().findNewMediaUpload(content('TWEET',{id:'2112743253263155200'}),new Set())).toBeNull();
 expect(helpers().findNewMediaUpload(content('VIDEO',{url:'blob:https://x.com/local-preview'}),new Set())).toMatchObject({mediaId:null,state:'pending'});
});

function observer(window:any, location={href:'https://x.com/compose/articles/edit/42'}) {
 const start=source.indexOf('  function existingMediaEntities('),end=source.indexOf('  function placeSelectionAtMarker(',start);
 return new Function('window','location',source.slice(start,end)+';return observeNativeMediaUpload;')(window,location)({size:12,type:'video/mp4'});
}
const id='2112743253263155200';
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
it('observes fetch INIT, processing and success without issuing requests or changing responses',async()=>{
 let body:any={media_id_string:id};
 const original=async()=>new Response(JSON.stringify(body),{status:200});
 const window:any={fetch:original};const watch=observer(window);
 const init=await window.fetch('https://upload.x.com/i/media/upload.json?command=INIT&total_bytes=12&media_type=video%2Fmp4');
 expect(await init.json()).toEqual(body);await tick();expect(watch.status(id)?.state).toBe('pending');
 body={processing_info:{state:'in_progress',progress_percent:43}};
 await window.fetch(`https://upload.x.com/i/media/upload.json?command=STATUS&media_id=${id}`);await tick();
 expect(watch.status(id)).toMatchObject({state:'processing',progress:43});
 body={processing_info:{state:'succeeded'}};
 await window.fetch(`https://upload.x.com/i/media/upload.json?command=STATUS&media_id=${id}`);await tick();
 expect(watch.status(null)).toMatchObject({state:'ready',mediaId:id});
 expect(watch.status('2112743253263155201')).toBeNull();
 watch.dispose();expect(window.fetch).toBe(original);
});
it('also supports native XHR uploads and removes hooks/listeners on cancellation',()=>{
 class XHR {
  listeners=new Set<()=>void>();responseType='json';response:any;status=200;
  open(_method:string,_url:string){} send(_body?:unknown){}
  addEventListener(_type:string,fn:()=>void){this.listeners.add(fn);}
  removeEventListener(_type:string,fn:()=>void){this.listeners.delete(fn);}
  finish(response:any){this.response=response;for(const fn of [...this.listeners])fn();}
 }
 const original=XHR.prototype.send,window:any={XMLHttpRequest:XHR},watch=observer(window);
 const request=new XHR();request.open('POST','https://upload.twitter.com/i/media/upload.json?command=INIT&total_bytes=12&media_type=video%2Fmp4');request.send();request.finish({media_id_string:id});
 const status=new XHR();status.open('GET',`https://upload.twitter.com/i/media/upload.json?command=STATUS&media_id=${id}`);status.send();
 status.finish({processing_info:{state:'failed',error:{message:'Unsupported codec'}}});
 expect(watch.status(id)).toMatchObject({state:'failed',error:'Unsupported codec'});
 const late=new XHR();late.open('GET',`https://upload.twitter.com/i/media/upload.json?command=STATUS&media_id=${id}`);late.send();
 expect(late.listeners.size).toBe(1);watch.dispose();expect(late.listeners.size).toBe(0);expect(XHR.prototype.send).toBe(original);
});
it('does not use unrelated or ambiguous native uploads as evidence for this file',async()=>{
 let nextId=id;const window:any={fetch:async()=>new Response(JSON.stringify({media_id_string:nextId}),{status:200})},watch=observer(window);
 await window.fetch('https://example.com/2/media/upload/initialize',{body:'{"total_bytes":12,"media_type":"video/mp4"}'});await tick();expect(watch.status(id)).toBeNull();
 for(const i of [id,'2112743253263155201']){nextId=i;await window.fetch('https://api.x.com/2/media/upload/initialize',{body:'{"total_bytes":12,"media_type":"video/mp4"}'});await tick();}
 expect(watch.status(null)).toBeNull();watch.dispose();
});
it('does not accept an unknown processing state or an unrelated nested user ID as readiness',()=>{
 expect(helpers().findNewMediaUpload(content('VIDEO',{media_id_string:id,processing_info:{state:'new_processing_state'}}),new Set())).toMatchObject({state:'processing'});
 expect(helpers().mediaIdFromEntityData({owner:{id},video_info:{duration_millis:12000}})).toBeNull();
});
it('ignores an existing media block whose entity key changes during an earlier GIF conversion',()=>{
 const before:any=new Set(['old-entity']);before.blockKeys=new Set(['video-block']);
 expect(helpers().findNewMediaUpload(content('VIDEO',{media_id_string:id}),before)).toBeNull();
});
