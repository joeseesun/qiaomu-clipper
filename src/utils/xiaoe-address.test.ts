import { expect, it } from 'vitest';
import { XIAOE_HOSTS, XIAOE_SHORT_HOSTS, isXiaoeLink, xiaoeAddress, xiaoeLiveAddress, xiaoeParts } from './xiaoe-address';
import { followXiaoeLink, isXiaoeMedia, readXiaoeLive } from './xiaoe';
const APP='appFixtureAbC123', LIVE='l_5ed8c094db164_GjDIuS0G';
const origin=`https://${APP.toLowerCase()}.h5.xiaoeknow.com`, canonical=xiaoeLiveAddress(APP,LIVE);
const b64=(value:object)=>btoa(JSON.stringify(value));
const shopOrigins=[origin,`https://${APP.toLowerCase()}.h5.xiaoe-tech.com`,...['xet.citv.cn','xet.pomoho.com'].flatMap(d=>[`https://${APP.toLowerCase()}.${d}`,`https://${APP.toLowerCase()}.h5.${d}`])];

it.each(XIAOE_SHORT_HOSTS.flatMap(host=>['s','sl'].map(path=>`https://school.${host}/${path}/Fixture123?share_type=5`)))('follows any supported short-share host/path: %s',async url=>{
 const login=origin+'/p/t/free/v1/basic-platform/h5_basic/login/auth?redirect_url='+encodeURIComponent(canonical);
 const get=(async()=>({url:login,text:async()=>''})) as unknown as typeof fetch;
 expect(isXiaoeLink(url)).toBe(true);expect(await followXiaoeLink(url,get)).toBe(canonical);
});
it.each(shopOrigins)('preserves the first-party shop origin and old live ID: %s',shop=>{
 for(const version of [1,2,3,4])expect(xiaoeAddress(`${shop}/v${version}/course/alive/${LIVE}?app_id=${APP}&share_type=5`)).toBe(xiaoeLiveAddress(APP,LIVE,shop));
 expect(xiaoeParts(xiaoeLiveAddress(APP,LIVE,shop))).toEqual({app:APP,live:LIVE,origin:shop});
 expect(isXiaoeMedia(xiaoeLiveAddress(APP,LIVE,shop),'https://video.xet.tech/fixture.m3u8?sign=fixture')).toBe(true);
});
it('reads a mini-program H5 destination, encoded old room and same-shop login wrappers',()=>{
 const alias=shopOrigins[shopOrigins.length-1], other=xiaoeLiveAddress(APP,LIVE,alias);
 expect(xiaoeAddress(`https://${APP.toLowerCase()}.mp.xiaoeknow.com/?params=${b64({app_id:APP,resource_id:LIVE,h5_url:other})}`)).toBe(other);
 expect(xiaoeAddress(origin+'/content_page/'+encodeURIComponent(b64({app_id:APP,resource_id:LIVE})))).toBe(canonical);
 const login=(url:string)=>origin+'/v1/auth?redirect_url='+encodeURIComponent(url);
 expect(xiaoeAddress(login(login(canonical)))).toBe(canonical);
 expect(xiaoeAddress(login(login(login(login(canonical)))))).toBeNull();
});
it('refuses cross-shop destinations, malformed credentials, misleading suffixes and non-live IDs',()=>{
 const login=(url:string)=>origin+'/v1/auth?redirect_url='+encodeURIComponent(url);
 expect(xiaoeAddress(login(canonical.replace(APP.toLowerCase(),'appother12345').replace('app_id='+APP,'app_id=appother12345')))).toBeNull();
 expect(xiaoeAddress(`https://${APP.toLowerCase()}.mp.xiaoeknow.com/?params=${b64({app_id:APP,resource_id:LIVE,h5_url:canonical.replace(LIVE,'l_other123456')})}`)).toBeNull();
 expect(xiaoeAddress(canonical.replace('/alive/'+LIVE,'/video/v_fixture12345'))).toBeNull();
 for(const domain of XIAOE_HOSTS){expect(isXiaoeLink(`https://school.${domain}.evil.example/s/x`)).toBe(false);expect(isXiaoeLink(`https://user:password@school.${domain}/s/x`)).toBe(false);expect(isXiaoeLink(`https://school.${domain}:8080/s/x`)).toBe(false);}
});
it('keeps alias login and metadata requests on that same shop',async()=>{
 const alias=shopOrigins[shopOrigins.length-1], address=xiaoeLiveAddress(APP,LIVE,alias);
 const result=await readXiaoeLive(address,async()=>({code:11302}),async()=>{throw Error('unused');});
 expect(result).toMatchObject({ok:false,error:'login',address});
 if(!result.ok && result.error==='login'){expect(new URL(result.loginUrl).origin).toBe(alias);expect(new URL(new URL(result.loginUrl).searchParams.get('redirect_url')!).origin).toBe(alias);}
});


it('normalizes tracking parameters and the standard WeChat navigation marker',()=>{
 expect(xiaoeAddress(canonical+'&share_type=5&entry=2#wechat_redirect')).toBe(canonical);
 expect(xiaoeAddress(canonical+'#arbitrary-player')).toBeNull();
 expect(isXiaoeLink('https://school.xetlk.com/sl/Fixture123#wechat_redirect')).toBe(true);
});
