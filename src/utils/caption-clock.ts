// Extrapolate only confirmed playback, and stop when the iframe stops reporting.
export class CaptionClock {
 private time=0;private rate=1;private at=0;private playing=false;
 sample(time:number|undefined,rate:number|undefined,playing:boolean|undefined,now:number){
  const current=this.read(now);
  this.time=typeof time==='number'&&Number.isFinite(time)&&time>=0?time:current;
  if(typeof rate==='number'&&Number.isFinite(rate)&&rate>0)this.rate=rate;
  if(typeof playing==='boolean')this.playing=playing;
  this.at=now;
 }
 read(now:number){return this.time+(this.playing?Math.min(1000,Math.max(0,now-this.at))*this.rate/1000:0);}
}
export function isChineseCaption(text:string):boolean {
 const han=(text.match(/[\u3400-\u9fff]/g)||[]).length;
 return han>0 && !/[\u3040-\u30ff\uac00-\ud7af]/.test(text) && han>text.replace(/[\s\p{P}\p{N}]/gu,'').length*.6;
}
