// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./browser-polyfill', () => ({ default: { runtime: { sendMessage: vi.fn() } } }));
import { getChannelsPlaybackMedia, channelsPlaybackPage, channelsStudyAddress, channelsShareAddress, isChannelsMedia, parseChannelsShare, readChannelsPlayback, channelsStudyBridge, probeChannelsStudy } from './channels-study';
const share='https://weixin.qq.com/sph/Fixture123';
const playback='https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture-token&eid=fixture-id';
const media='https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture';
const info={ok:true as const,title:'Fixture',author:'',seconds:110,thumbnail:null,site:'WeChat Channels',mediaUrl:media,video:true};
beforeEach(()=>document.body.replaceChildren());afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('accepts only canonical shares and Tencent media; never uses bearer playback URLs as history',()=>{
 expect(channelsShareAddress(share)).toBe(share);expect(channelsShareAddress('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Fixture123')).toBe(share);
 for(const u of [playback,share+'?token=x','http://weixin.qq.com/sph/Fixture123','https://user:pw@weixin.qq.com/sph/Fixture123','https://weixin.qq.com.evil.org/sph/Fixture123'])expect(channelsShareAddress(u)).toBeUndefined();
 expect(isChannelsMedia(share,media)).toBe(true);
 for(const u of [media.replace('https:','http:'),media.replace('finder.video.qq.com','evil.org'),media.replace('/251/20302/stodownload','/other'),media.replace('finder.video.qq.com','finder.video.qq.com:8080'),media+'#x'])expect(isChannelsMedia(share,u)).toBe(false);
});
it('uses the resolver own login, distinguishes 401, and rejects foreign playback origins',async()=>{
 vi.stubGlobal('location',{origin:'https://yuanbao.tencent.com'});const fetch=vi.fn().mockResolvedValueOnce({status:401}).mockResolvedValueOnce({ok:true,status:200,json:()=>Promise.resolve({code:0,data:{playable_url:'https://evil.org/?token=fixture'}})}).mockResolvedValue({ok:true,status:200,json:()=>Promise.resolve({code:0,data:{playable_url:playback}})});vi.stubGlobal('fetch',fetch);
 expect(await parseChannelsShare(share)).toEqual({state:'login'});expect(await parseChannelsShare(share)).toEqual({state:'unavailable'});expect(await parseChannelsShare(share)).toEqual({state:'ready',playbackUrl:playback});
 expect(fetch.mock.calls[0][0]).toBe('/api/weixin/get_parse_result');const req=fetch.mock.calls[0][1];expect(req.credentials).toBe('same-origin');expect(JSON.parse(req.body)).toEqual({type:'video_channel_url',url:share,scene:1});expect(req.headers).not.toHaveProperty('Cookie');
});
it('reads only the official feed and never forwards resolver cookies or returns the general token',async()=>{
 vi.stubGlobal('location',{href:playback});const fetch=vi.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({errCode:0,data:{errMsg:{type:0},feedInfo:{description:'Fixture',h264VideoInfo:{videoUrl:media}}}})});vi.stubGlobal('fetch',fetch);
 const answer=await readChannelsPlayback();expect(answer.state).toBe('ready');expect(JSON.stringify(answer)).not.toContain('fixture-token');expect(fetch.mock.calls[0][1].credentials).toBe('omit');
 vi.stubGlobal('location',{href:'https://evil.org/'});expect(await readChannelsPlayback()).toEqual({state:'unavailable'});expect(fetch).toHaveBeenCalledTimes(1);
});
it('requires explicit opening, reader ownership, exact share, and unchanged playback tab',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8});const get=vi.fn().mockImplementation(id=>Promise.resolve({url:id===7?'https://yuanbao.tencent.com/':playback}));const parse=vi.fn().mockResolvedValue({state:'ready',playbackUrl:playback}),inspect=vi.fn().mockResolvedValue({state:'ready',info});const bridge=channelsStudyBridge({create,get,parse,inspect});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});expect(parse).not.toHaveBeenCalled();
 expect(await bridge(1,{mode:'open',url:share})).toEqual({state:'opened'});
 expect(await bridge(2,{mode:'read',url:share})).toEqual({state:'unavailable'});expect(await bridge(1,{mode:'read',url:share+'Other'})).toEqual({state:'unavailable'});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'loading'});expect(create).toHaveBeenLastCalledWith({url:playback,active:false});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'ready',info,sourceUrl:share});expect(JSON.stringify(await bridge(1,{mode:'read',url:share}))).not.toContain('fixture-token');
});
it('keeps login and rejected media failures recoverable, and rejects navigation races',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),get=vi.fn().mockResolvedValue({url:'https://yuanbao.tencent.com/'}),parse=vi.fn().mockResolvedValueOnce({state:'login'}).mockResolvedValue({state:'ready',playbackUrl:playback}),inspect=vi.fn().mockResolvedValue({state:'ready',info:{...info,mediaUrl:'https://evil.org/video'}}),bridge=channelsStudyBridge({create,get,parse,inspect});
 await bridge(1,{mode:'open',url:share});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'login'});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'loading'});
 get.mockResolvedValue({url:playback});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});
 inspect.mockResolvedValue({state:'ready',info});get.mockResolvedValueOnce({url:playback}).mockResolvedValueOnce({url:playback+'&eid=other'});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});
});
it('starts reading by itself, shows two steps, and brings Yuanbao forward only to sign in',async()=>{
 vi.useFakeTimers();
 const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
 const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValueOnce({state:'loading'}).mockResolvedValueOnce({state:'login'}).mockResolvedValue({state:'ready',info,sourceUrl:share});
 const done=probeChannelsStudy(share,status,holder,request);
 await vi.advanceTimersByTimeAsync(0);expect(request).toHaveBeenNthCalledWith(1,{action:'qiaomuChannelsStudy',mode:'open',url:share});
 expect(Array.from(holder.querySelectorAll('li')).map(li=>li.textContent)).toEqual(['通过腾讯元宝读取视频','生成字幕']);expect(holder.textContent).toContain('只把这条链接交给元宝解析');
 const [open,retry]=Array.from(holder.querySelectorAll('button'));expect(open.hidden).toBe(true);expect(retry.hidden).toBe(true);expect(holder.textContent).toContain('已登录元宝的话会自动完成');
 await vi.advanceTimersByTimeAsync(3000);await vi.advanceTimersByTimeAsync(3000);
 expect(holder.textContent).toContain('需要先登录腾讯元宝');expect(open.hidden).toBe(false);
 open.click();await vi.advanceTimersByTimeAsync(0);expect(request).toHaveBeenCalledWith({action:'qiaomuChannelsStudy',mode:'show',url:share});
 await vi.advanceTimersByTimeAsync(3000);expect(await done).toEqual({info,sourceUrl:share});expect(holder.querySelector('.qiaomu-web-retry')).toBeNull();
});

it('rejects navigation during playback inspection even when the media itself is valid', async () => {
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),get=vi.fn().mockResolvedValue({url:'https://yuanbao.tencent.com/'}),parse=vi.fn().mockResolvedValue({state:'ready',playbackUrl:playback}),inspect=vi.fn().mockResolvedValue({state:'ready',info}),bridge=channelsStudyBridge({create,get,parse,inspect});
 await bridge(1,{mode:'open',url:share});await bridge(1,{mode:'read',url:share});get.mockResolvedValueOnce({url:playback}).mockResolvedValueOnce({url:playback+'&eid=other'});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});expect(inspect).toHaveBeenCalledTimes(1);
});

it('automatically reads through login and playback loading after one disclosed open action',async()=>{
 vi.useFakeTimers();const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
 const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValueOnce({state:'login'}).mockResolvedValueOnce({state:'loading'}).mockResolvedValue({state:'ready',info,sourceUrl:share});const done=probeChannelsStudy(share,status,holder,request);
 holder.querySelector('button')!.click();await vi.advanceTimersByTimeAsync(10000);expect(await done).toEqual({info,sourceUrl:share});expect(request).toHaveBeenCalledTimes(4);await vi.advanceTimersByTimeAsync(20000);expect(request).toHaveBeenCalledTimes(4);
});
it('stops after three unavailable answers, offers a retry, and cancels when the page closes',async()=>{
 vi.useFakeTimers();const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
 const request=vi.fn().mockResolvedValueOnce({state:'opened'}).mockResolvedValue({state:'unavailable'});
 void probeChannelsStudy(share,status,holder,request);await vi.advanceTimersByTimeAsync(20000);
 const reads=request.mock.calls.filter(call=>call[0].mode==='read').length;expect(reads).toBe(3);
 const retry=holder.querySelectorAll('button')[1];expect(retry.hidden).toBe(false);expect(holder.textContent).toContain('没能读取这条视频');
 request.mockClear();window.dispatchEvent(new Event('pagehide'));expect(request).toHaveBeenCalledWith({action:'qiaomuChannelsStudy',mode:'cancel',url:share});expect(vi.getTimerCount()).toBe(0);
});
it('waits for freshly opened tabs instead of treating navigation as a failed video',async()=>{
 const create=vi.fn().mockResolvedValue({id:7}),get=vi.fn().mockResolvedValue({url:'about:blank',status:'loading'}),parse=vi.fn(),inspect=vi.fn(),bridge=channelsStudyBridge({create,get,parse,inspect});await bridge(1,{mode:'open',url:share});expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'loading'});expect(parse).not.toHaveBeenCalled();
});
it('keys the official playback page by export id only and drops the token',()=>{
 const key='https://channels.weixin.qq.com/finder-preview/pages/feed?eid=fixture-id';
 expect(channelsPlaybackPage(playback)).toBe(key);expect(channelsPlaybackPage(key)).toBe(key);expect(channelsStudyAddress(playback)).toBe(key);expect(channelsStudyAddress(share)).toBe(share);
 expect(channelsPlaybackPage('https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a%2Fb')).toBe('https://channels.weixin.qq.com/finder-preview/pages/feed?eid=a%2Fb');
 for(const u of ['https://channels.weixin.qq.com/finder-preview/pages/feed?token=only','https://channels.weixin.qq.com/finder-preview/pages/feed?eid=','http://channels.weixin.qq.com/finder-preview/pages/feed?eid=x','https://channels.weixin.qq.com.evil.org/finder-preview/pages/feed?eid=x','https://evil.org/finder-preview/pages/feed?eid=x','https://channels.weixin.qq.com/other?eid=x','https://u:p@channels.weixin.qq.com/finder-preview/pages/feed?eid=x','https://channels.weixin.qq.com/finder-preview/pages/feed?eid='+'a'.repeat(201)])expect(channelsPlaybackPage(u)).toBeUndefined();
 expect(isChannelsMedia(key,media)).toBe(true);expect(isChannelsMedia(playback,media)).toBe(true);expect(isChannelsMedia(playback,media.replace('finder.video.qq.com','evil.org'))).toBe(false);
});
it('lends the open playback tab media only for that exact video and a verified address',async()=>{
 const key='https://channels.weixin.qq.com/finder-preview/pages/feed?eid=fixture-id';
 const api=(answer:unknown,tabUrl=playback)=>({get:vi.fn().mockResolvedValue({url:tabUrl}),query:vi.fn().mockResolvedValue([{id:9,url:playback}]),sendMessage:vi.fn().mockResolvedValue(answer)});
 const good={url:key,info:{...info,title:'T',description:'D'}};
 expect(await getChannelsPlaybackMedia(key,5,api(good))).toMatchObject({ok:true,mediaUrl:media,title:'T',video:true});
 const other=api(good,'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=another');
 expect(await getChannelsPlaybackMedia(key,5,other)).toBeDefined();expect(other.query).toHaveBeenCalled();
 expect(await getChannelsPlaybackMedia(key,5,api({url:'https://channels.weixin.qq.com/finder-preview/pages/feed?eid=other',info}))).toBeUndefined();
 expect(await getChannelsPlaybackMedia(key,5,api({url:key,info:{...info,mediaUrl:media.replace('finder.video.qq.com','evil.org')}}))).toBeUndefined();
 expect(await getChannelsPlaybackMedia(share,5,api(good))).toBeUndefined();
 const none=api(good);none.get.mockRejectedValue(new Error('closed'));none.query.mockResolvedValue([]);expect(await getChannelsPlaybackMedia(key,5,none)).toBeUndefined();
});
it('can still wait for a click when asked not to start by itself',async()=>{
 const holder=document.createElement('div'),status=document.createElement('p');document.body.append(holder,status);
 const request=vi.fn().mockResolvedValue({state:'opened'});void probeChannelsStudy(share,status,holder,request,false);
 await Promise.resolve();expect(request).not.toHaveBeenCalled();expect(holder.querySelectorAll('button')[1].hidden).toBe(false);
});

it('opens the official playback page behind the study page and closes it once the video is read',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),remove=vi.fn().mockResolvedValue(undefined);
 const get=vi.fn().mockImplementation(id=>Promise.resolve({url:id===7?'https://yuanbao.tencent.com/':playback}));
 const bridge=channelsStudyBridge({create,remove,get,parse:vi.fn().mockResolvedValue({state:'ready',playbackUrl:playback}),inspect:vi.fn().mockResolvedValue({state:'ready',info})});
 await bridge(1,{mode:'open',url:share});await bridge(1,{mode:'read',url:share});
 expect(create).toHaveBeenLastCalledWith({url:playback,active:false});expect(remove).not.toHaveBeenCalled();
 expect(await bridge(1,{mode:'read',url:share})).toMatchObject({state:'ready'});expect(remove).toHaveBeenCalledWith(8);
});
it('keeps Yuanbao in the background, surfaces it once for sign-in, then closes both tabs and returns to the study page',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),remove=vi.fn().mockResolvedValue(undefined),update=vi.fn().mockResolvedValue(undefined);
 const get=vi.fn().mockImplementation(id=>Promise.resolve({url:id===7?'https://yuanbao.tencent.com/':playback}));
 const parse=vi.fn().mockResolvedValueOnce({state:'login'}).mockResolvedValueOnce({state:'login'}).mockResolvedValue({state:'ready',playbackUrl:playback});
 const bridge=channelsStudyBridge({create,remove,update,get,parse,inspect:vi.fn().mockResolvedValue({state:'ready',info})});
 await bridge(1,{mode:'open',url:share});expect(create).toHaveBeenCalledWith({url:'https://yuanbao.tencent.com/',active:false});
 expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'login'});await bridge(1,{mode:'read',url:share});
 expect(update.mock.calls.filter(call=>call[0]===7&&call[1].active===true)).toHaveLength(1);
 await bridge(1,{mode:'read',url:share});expect(create).toHaveBeenLastCalledWith({url:playback,active:false});
 expect(await bridge(1,{mode:'read',url:share})).toMatchObject({state:'ready'});
 expect(remove).toHaveBeenCalledWith(7);expect(remove).toHaveBeenCalledWith(8);expect(update).toHaveBeenLastCalledWith(1,{active:true});
});
it('shows Yuanbao on request, and cancel closes whatever the study page opened',async()=>{
 const create=vi.fn().mockResolvedValueOnce({id:7}).mockResolvedValue({id:8}),remove=vi.fn().mockResolvedValue(undefined),update=vi.fn().mockResolvedValue(undefined);
 const bridge=channelsStudyBridge({create,remove,update,get:vi.fn(),parse:vi.fn(),inspect:vi.fn()});
 expect(await bridge(1,{mode:'show',url:share})).toEqual({state:'unavailable'});
 await bridge(1,{mode:'open',url:share});expect(await bridge(1,{mode:'show',url:share})).toEqual({state:'opened'});expect(update).toHaveBeenCalledWith(7,{active:true});
 await bridge(1,{mode:'cancel',url:share});expect(remove).toHaveBeenCalledWith(7);expect(await bridge(1,{mode:'read',url:share})).toEqual({state:'unavailable'});
 await bridge(2,{mode:'open',url:share});await bridge(2,{mode:'open',url:share});expect(remove).toHaveBeenCalledWith(8);
});
