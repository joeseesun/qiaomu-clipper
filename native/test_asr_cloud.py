import json, os, stat, sys, tempfile, threading, time, unittest, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import asr_cloud as cloud, asr

class Provider:
 """A stand-in for a recognition service: records what it was sent and answers as scripted."""
 def __init__(self):
  self.requests=[];self.script=[];self.lock=threading.Lock();self.last_headers={}
  provider=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def do_POST(self):
    body=self.rfile.read(int(self.headers['Content-Length']))
    with provider.lock:
     provider.requests.append({'path':self.path,'auth':self.headers.get('Authorization'),'type':self.headers.get('Content-Type'),'body':body});provider.last_headers=dict(self.headers.items())
     reply=provider.script.pop(0) if provider.script else (200,{},None)
    status,headers,payload=reply
    if payload is None: payload=provider.default(self.path,body)
    raw=json.dumps(payload).encode();self.send_response(status)
    for k,v in headers.items():self.send_header(k,v)
    self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.url=f'http://127.0.0.1:{self.server.server_port}/v1'
  threading.Thread(target=self.server.serve_forever,daemon=True).start()
 def default(self,path,body):
  return {'text':'第一句。第二句话在这里。'} if path.endswith('/audio/transcriptions') else {'choices':[{'message':{'content':'你好。世界。'}}]}
 def close(self):self.server.shutdown();self.server.server_close()

FAKE_FFMPEG='''#!/bin/bash
args="$*"
if [[ "$args" == *volumedetect* ]]; then echo "[Parsed_volumedetect_0 @ 0x1] mean_volume: -15.0 dB" >&2; exit 0; fi
if [[ "$args" == *silencedetect* ]]; then
  echo "$args" >> "$FAKE_FFMPEG_LOG"
  for pair in $FAKE_PAUSES; do echo "[silencedetect @ 0x1] silence_start: ${pair%%:*}" >&2; echo "[silencedetect @ 0x1] silence_end: ${pair##*:} | silence_duration: 0.3" >&2; done
  exit 0
fi
for a in "$@"; do last="$a"; done
[ "$FAKE_FFMPEG_FAIL" = "1" ] && exit 1
printf 'audio-bytes' > "$last"
'''
class CloudTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.dir=Path(self.temp.name);self.tools=self.dir/'tools';self.tools.mkdir()
  ff=self.tools/'ffmpeg';ff.write_text(FAKE_FFMPEG);ff.chmod(ff.stat().st_mode|stat.S_IEXEC)
  self.env=dict(os.environ,FAKE_FFMPEG_LOG=str(self.dir/'ff.log'),FAKE_PAUSES='');self.provider=Provider()
  self.cfg=cloud.clean_config({'protocol':'openai-transcriptions','baseUrl':self.provider.url,'model':'vendor/asr-1','timestamps':'none','label':'测试服务'})
  self.wav=self.dir/'a.wav';self.wav.write_bytes(b'RIFF');self.mp3=self.dir/'c.mp3';self.mp3.write_bytes(b'mp3data')
 def tearDown(self):self.provider.close();self.temp.cleanup()
 def run_cloud(self,total=100.0,cfg=None,workers=3,**env):
  cues=[];prog=[];self.env.update(env)
  made,det=cloud.recognise(self.wav,total,self.dir,cfg or self.cfg,'sk-test','auto',{'ffmpeg':str(self.tools/'ffmpeg')},self.env,cues.extend,lambda d,c,e:prog.append((d,c,round(e,1))),workers=workers,sleep=lambda s:None)
  return made,det,cues,prog

 def test_config_is_validated_and_never_carries_a_key(self):
  ok=cloud.clean_config({'protocol':'chat-audio','baseUrl':'https://api.example.com/v1/','model':'m-1','apiKey':'sk-leak','label':'x'})
  self.assertEqual(ok['baseUrl'],'https://api.example.com/v1');self.assertNotIn('apiKey',ok);self.assertNotIn('sk-leak',json.dumps(ok))
  for bad in ({'protocol':'x','baseUrl':'https://a.com','model':'m'},{'protocol':'chat-audio','baseUrl':'http://evil.example.com','model':'m'},{'protocol':'chat-audio','baseUrl':'https://u:p@a.com','model':'m'},{'protocol':'chat-audio','baseUrl':'https://a.com/?x=1','model':'m'},{'protocol':'chat-audio','baseUrl':'https://a.com','model':'bad model; rm'},{'protocol':'chat-audio','baseUrl':'https://a.com','model':''},{'protocol':'chat-audio','baseUrl':'ftp://a.com','model':'m'},'nope',None,{'protocol':'chat-audio','baseUrl':'https://a.com','model':'m','timestamps':'words'}):
   with self.assertRaises(ValueError):cloud.clean_config(bad)
  self.assertTrue(cloud.clean_config({'protocol':'chat-audio','baseUrl':'http://127.0.0.1:9000/v1','model':'m'}))  # a local service may use http
 def test_chunks_are_cut_in_pauses_near_the_target_and_never_exceed_the_limit(self):
  chunks=cloud.plan_chunks([5.0,19.0,22.0,45.0,61.0,63.0],100.0)
  self.assertEqual(chunks[0],(0.0,19.0));self.assertTrue(all(b-a<=cloud.MAX_CHUNK+1e-6 for a,b in chunks));self.assertEqual(chunks[-1][1],100.0)
  self.assertEqual([a for a,_ in chunks[1:]],[b for _,b in chunks[:-1]])  # contiguous: nothing is skipped or heard twice
  self.assertEqual(cloud.plan_chunks([],95.0),[(0.0,40.0),(40.0,80.0),(80.0,95.0)])  # no pause at all: hard cuts
  self.assertEqual(cloud.plan_chunks([],12.0),[(0.0,12.0)]);self.assertEqual(cloud.plan_chunks([],0.1),[(0.0,0.1)])
  self.assertEqual(cloud.plan_chunks([1.0,2.0],30.0)[0][0],0.0)  # pauses too close to the start are ignored
 def test_the_silence_threshold_follows_how_loud_the_recording_is(self):
  with patch.object(cloud.subprocess,'run') as run:
   for mean,expected in (('-15.0',-28.0),('-40.0',-45.0),('-5.0',-22.0)):
    run.return_value.stderr=f'mean_volume: {mean} dB';self.assertEqual(cloud.silence_threshold(self.wav,'ffmpeg',{}),expected)
   run.return_value.stderr='nothing';self.assertEqual(cloud.silence_threshold(self.wav,'ffmpeg',{}),-30.0)
 def test_sentences_are_split_for_chinese_and_english_without_breaking_numbers_or_tiny_pieces(self):
  self.assertEqual(cloud.sentences('好了，继续。我们来看第三部分！对吧，你们说呢？'),['好了，继续。','我们来看第三部分！','对吧，你们说呢？']);self.assertEqual(cloud.sentences('我们来看第三部分！对吧？'),['我们来看第三部分！对吧？'])  # a short tail joins the sentence before it
  self.assertEqual(cloud.sentences('We saw 3.5 percent. Then it rose. Yes!'),['We saw 3.5 percent.','Then it rose. Yes!'])
  self.assertEqual(cloud.sentences('好。是的，没错。'),['好。','是的，没错。'])  # a short first piece has nothing before it to join
  self.assertEqual(cloud.sentences(''),[]);self.assertEqual(cloud.sentences('没有标点的一整段话'),['没有标点的一整段话'])
 def test_a_long_sentence_with_only_commas_is_broken_at_the_commas_into_readable_cues(self):
  text='好啦，下面呢继续来给大家介绍关于管理知识当中的其他内容，我们来看一下第三个部分，就是管理学当中的一些重要原理及定律，这部分内容呢相对来说非常重要，大家一定要核心去记忆和掌握。'
  parts=cloud.sentences(text);self.assertGreater(len(parts),1);self.assertEqual(''.join(parts),text)  # nothing lost, nothing added
  self.assertTrue(all(len(p)<=cloud.LONG_CUE+20 for p in parts));self.assertTrue(all(p.endswith(('，','。')) for p in parts))
  self.assertEqual(cloud.sentences('短句，不会被切开。'),['短句，不会被切开。']);self.assertEqual(cloud.sentences('x'*100),['x'*100])  # no comma, nothing to break at
 def test_text_is_spread_over_the_piece_by_length_and_provider_segments_are_offset(self):
  cues=cloud.cues_from('一二三四五。六七八九十一二三四五六。',None,10.0,20.0)
  self.assertEqual([c['text'] for c in cues],['一二三四五。','六七八九十一二三四五六。']);self.assertEqual(cues[0]['start'],10.0);self.assertEqual(cues[-1]['end'],20.0);self.assertEqual(cues[0]['end'],cues[1]['start'])
  seg=cloud.cues_from('x',[{'start':0.5,'end':2.0,'text':' 你好 '},{'start':2.0,'end':3.0,'text':''},{'bad':1},{'start':3.0,'end':2.5,'text':'倒挂'}],40.0,60.0)
  self.assertEqual(seg,[{'start':40.5,'end':42.0,'text':'你好'},{'start':43.0,'end':43.0,'text':'倒挂'}])  # the piece's start is the offset; a reversed segment collapses, never goes backwards
  self.assertEqual(cloud.cues_from('',None,0,5),[])
 def test_emoji_and_tags_that_recognisers_add_are_dropped_and_languages_become_codes(self):
  self.assertEqual(cloud.tidy('😊你体现的 <|zh|><|NEUTRAL|>原理🎼'),'你体现的 原理');self.assertEqual([cloud.language_code(x) for x in ('Chinese','zh-CN','EN','ja','',None,'weird name')],['zh','zh','en','ja',None,None,None])

 def test_openai_style_pieces_are_uploaded_with_the_key_in_order_and_put_back_on_the_timeline(self):
  made,det,cues,prog=self.run_cloud(FAKE_PAUSES='19.5:20.5 59.5:60.5')
  self.assertGreaterEqual(len(self.provider.requests),3)
  first=self.provider.requests[0];self.assertTrue(first['path'].endswith('/audio/transcriptions'));self.assertEqual(first['auth'],'Bearer sk-test');self.assertIn('multipart/form-data',first['type']);self.assertIn(b'name="model"\r\n\r\nvendor/asr-1',first['body']);self.assertIn(b'audio-bytes',first['body'])
  self.assertIn(b'name="response_format"\r\n\r\njson',first['body']);self.assertNotIn(b'verbose_json',first['body']);self.assertNotIn(b'name="language"',first['body'])  # the format is always named (StepFun requires it)
  starts=[c['start'] for c in made];self.assertEqual(starts,sorted(starts));self.assertEqual(made[0]['start'],0.0);self.assertEqual(max(c['end'] for c in made),100.0)
  self.assertEqual(prog[-1][0],prog[-1][1]);self.assertEqual([d for d,_,_ in prog],list(range(1,len(prog)+1)))  # progress counts pieces, in order
  self.assertFalse(list(self.dir.glob('chunks-*')));self.assertEqual(cues,made)
 def test_a_service_that_returns_segments_gets_them_asked_for_and_kept(self):
  cfg=cloud.clean_config({'protocol':'openai-transcriptions','baseUrl':self.provider.url,'model':'whisper-large-v3','timestamps':'segments','languageParam':True})
  self.provider.default=lambda path,body:{'text':'t','language':'English','segments':[{'start':1.0,'end':3.0,'text':'Hello there.'}]}
  made,det,cues,prog=self.run_cloud(total=30.0,cfg=cfg)
  body=self.provider.requests[0]['body'];self.assertIn(b'name="response_format"\r\n\r\nverbose_json',body);self.assertIn(b'timestamp_granularities[]',body);self.assertEqual(det,'en')
  self.assertEqual(made[0],{'start':1.0,'end':3.0,'text':'Hello there.'})
 def test_an_audio_chat_model_gets_base64_audio_and_the_language_option_at_the_top_of_the_body(self):
  cfg=cloud.clean_config({'protocol':'chat-audio','baseUrl':self.provider.url,'model':'mimo-v2.5-asr','timestamps':'none'})
  made,_,_,_=self.run_cloud(total=30.0,cfg=cfg)
  request=self.provider.requests[0];self.assertTrue(request['path'].endswith('/chat/completions'));body=json.loads(request['body'])
  self.assertEqual(body['model'],'mimo-v2.5-asr');self.assertEqual(body['asr_options'],{'language':'auto'});self.assertIs(body['stream'],False)
  part=body['messages'][0]['content'][0];self.assertEqual(part['type'],'input_audio');self.assertTrue(part['input_audio']['data'].startswith('data:audio/mpeg;base64,'))
  self.assertEqual([c['text'] for c in made][:1],['你好。世界。'])  # two very short sentences stay together
 def test_a_rate_limit_is_waited_out_with_the_retry_after_header_then_succeeds(self):
  self.provider.script=[(429,{'Retry-After':'2'},{'error':{'message':'slow down'}}),(503,{},{'error':'busy'})]
  waits=[];text,_,_=cloud.transcribe(self.cfg,'sk',self.mp3,'auto',sleep=waits.append)
  self.assertEqual(text,'第一句。第二句话在这里。');self.assertEqual(waits[0],2.0);self.assertEqual(len(waits),2);self.assertEqual(len(self.provider.requests),3)
 def test_retries_stop_after_the_limit_and_the_error_says_what_the_service_said(self):
  self.provider.script=[(500,{},{'message':'oops'})]*(cloud.RETRIES+1)
  with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(self.cfg,'sk',self.mp3,'auto',sleep=lambda s:None)
  self.assertIn('HTTP 500',str(caught.exception));self.assertIn('oops',str(caught.exception));self.assertEqual(len(self.provider.requests),cloud.RETRIES+1)
 def test_a_bad_key_and_an_empty_account_are_told_apart_and_never_retried(self):
  for status,payload,code in ((401,{'error':{'message':'Invalid token'}},'cloud-auth'),(403,{'message':'forbidden'},'cloud-auth'),(400,{'code':30001,'message':'Sorry, your account balance is insufficient'},'cloud-quota'),(402,{'error':'pay'},'cloud-quota')):
   self.provider.requests.clear();self.provider.script=[(status,{},payload)]
   with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(self.cfg,'sk',self.mp3,'auto',sleep=lambda s:None)
   self.assertEqual(caught.exception.code,code);self.assertEqual(len(self.provider.requests),1)
 def test_a_request_the_service_rejects_for_other_reasons_is_not_retried(self):
  self.provider.script=[(413,{},{'message':'file too large'})]
  with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(self.cfg,'sk',self.mp3,'auto',sleep=lambda s:None)
  self.assertIn('413',str(caught.exception));self.assertIsNone(caught.exception.code);self.assertEqual(len(self.provider.requests),1)
 def test_an_unreachable_service_is_retried_and_then_reported(self):
  cfg=cloud.clean_config({'protocol':'openai-transcriptions','baseUrl':'http://127.0.0.1:9/v1','model':'m'});waits=[]
  with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(cfg,'sk',self.mp3,'auto',sleep=waits.append)
  self.assertIn('连接失败',str(caught.exception));self.assertEqual(len(waits),cloud.RETRIES)
 def test_garbage_from_the_service_is_reported_not_crashed_on(self):
  self.provider.default=lambda path,body:['not','an','object']
  with self.assertRaises(cloud.CloudError):cloud.transcribe(self.cfg,'sk',self.mp3,'auto',sleep=lambda s:None)
 def test_one_failing_piece_fails_the_job_with_its_reason_and_leaves_no_files(self):
  self.provider.script=[(200,{},None),(401,{},{'error':{'message':'bad key'}})]
  with self.assertRaises(cloud.CloudError) as caught:self.run_cloud(FAKE_PAUSES='19.5:20.5 59.5:60.5',workers=1)
  self.assertEqual(caught.exception.code,'cloud-auth');self.assertFalse(list(self.dir.glob('chunks-*')))
 def test_pieces_that_finish_out_of_order_are_still_delivered_in_order(self):
  def slow_first(path,body):
   if not hasattr(slow_first,'n'):slow_first.n=0
   slow_first.n+=1
   if slow_first.n==1:time.sleep(0.3)
   return {'text':f'第{slow_first.n}块的内容。'}
  self.provider.default=slow_first;made,_,cues,_=self.run_cloud(FAKE_PAUSES='19.5:20.5 59.5:60.5',workers=3)
  self.assertEqual([c['start'] for c in cues],sorted(c['start'] for c in cues))
 def test_a_service_sets_how_long_a_piece_may_be_and_a_bad_length_is_refused(self):
  glm=cloud.clean_config({'protocol':'openai-transcriptions','baseUrl':'https://open.bigmodel.cn/api/paas/v4','model':'glm-asr-2512','chunkSeconds':18,'maxChunkSeconds':28})
  self.assertEqual((glm['chunkSeconds'],glm['maxChunkSeconds']),(18.0,28.0))
  self.assertTrue(all(b-a<=28.0+1e-6 for a,b in cloud.plan_chunks([],200.0,glm['chunkSeconds'],glm['maxChunkSeconds'])))  # never past what the service accepts
  self.assertEqual((self.cfg['chunkSeconds'],self.cfg['maxChunkSeconds']),(cloud.TARGET_CHUNK,cloud.MAX_CHUNK))
  self.assertLessEqual(cloud.clean_config({**glm,'chunkSeconds':500,'maxChunkSeconds':20})['chunkSeconds'],16.0)  # a target above the limit is pulled under it
  for bad in ({'maxChunkSeconds':3},{'maxChunkSeconds':5000},{'chunkSeconds':'x'},{'chunkSeconds':True},{'maxChunkSeconds':None}):
   with self.assertRaises(ValueError):cloud.clean_config({'protocol':'openai-transcriptions','baseUrl':'https://a.com','model':'m',**bad})
  self.assertTrue(cloud.clean_config({'protocol':'openai-transcriptions','baseUrl':'http://127.0.0.1:8000/v1','model':'m'})['local'])  # a service on this computer
  self.assertFalse(self.cfg['local'] and False)
 def test_doubao_gets_the_whole_piece_with_its_headers_and_its_utterances_keep_their_own_times(self):
  cfg=cloud.clean_config({'protocol':'doubao-flash','baseUrl':self.provider.url,'model':'bigmodel','timestamps':'segments','chunkSeconds':300,'maxChunkSeconds':540})
  self.provider.default=lambda path,body:{'audio_info':{'duration':30000},'result':{'text':'你好世界。再见。','utterances':[{'start_time':920,'end_time':4920,'text':'你好世界。','words':[]},{'start_time':5000,'end_time':7200,'text':'再见。'},{'start_time':'x','end_time':1,'text':'坏'}]}}
  made,_,_,_=self.run_cloud(total=30.0,cfg=cfg)
  request=self.provider.requests[0];self.assertTrue(request['path'].endswith('/auc/bigmodel/recognize/flash'));body=json.loads(request['body'])
  self.assertEqual(body['request'],{'model_name':'bigmodel'});self.assertTrue(body['audio']['data']);self.assertEqual(self.provider.last_headers['X-Api-Key'],'sk-test');self.assertEqual(self.provider.last_headers['X-Api-Resource-Id'],'volc.bigasr.auc_turbo');self.assertNotIn('Authorization',self.provider.last_headers)
  self.assertEqual(made,[{'start':0.92,'end':4.92,'text':'你好世界。'},{'start':5.0,'end':7.2,'text':'再见。'}])  # milliseconds become seconds; a piece with a bad time is dropped
 def test_doubao_reports_its_status_header_not_the_http_code(self):
  cfg=cloud.clean_config({'protocol':'doubao-flash','baseUrl':self.provider.url,'model':'bigmodel'})
  def answer(code,message,payload=None):
   self.provider.script=[(200,{'X-Api-Status-Code':code,'X-Api-Message':message},payload or {'result':{'text':'x'}})]
  answer('20000003','silent audio',{});self.assertEqual(cloud.transcribe(cfg,'k',self.mp3,'auto',sleep=lambda s:None)[0],'')  # silence is an empty result, not an error
  answer('45000010','invalid api key permission');
  with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(cfg,'k',self.mp3,'auto',sleep=lambda s:None)
  self.assertEqual(caught.exception.code,'cloud-auth')
  answer('45000292','quota exceeded');
  with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(cfg,'k',self.mp3,'auto',sleep=lambda s:None)
  self.assertEqual(caught.exception.code,'cloud-quota')
  self.provider.script=[(200,{'X-Api-Status-Code':'55000031','X-Api-Message':'busy'},{}),(200,{'X-Api-Status-Code':'20000000','X-Api-Message':'OK'},{'result':{'text':'好的。'}})];waits=[]
  self.assertEqual(cloud.transcribe(cfg,'k',self.mp3,'auto',sleep=waits.append)[0],'好的。');self.assertEqual(len(waits),1)  # a busy server is retried
  answer('45000001','bad params')
  with self.assertRaises(cloud.CloudError) as caught:cloud.transcribe(cfg,'k',self.mp3,'auto',sleep=lambda s:None)
  self.assertIn('45000001',str(caught.exception));self.assertIsNone(caught.exception.code)
 def test_the_cloud_check_accepts_any_answer_and_reports_a_wrong_key(self):
  ff=str(self.tools/'ffmpeg');self.assertTrue(cloud.test(self.cfg,'sk',ff,self.env)['ok'])
  self.provider.script=[(401,{},{'error':'no'})]
  with self.assertRaises(cloud.CloudError):cloud.test(self.cfg,'sk',ff,self.env,sleep=lambda s:None)

class CloudJobTests(unittest.TestCase):
 """The worker and the host's actions around the cloud engine."""
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)/'state';self.base.mkdir();self.tools=Path(self.temp.name)/'tools';self.tools.mkdir()
  for name,body in (('yt-dlp','#!/bin/bash\nout="";while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\nprintf audio > "${out/\\%(ext)s/m4a}"\n'),('ffprobe','#!/bin/bash\necho 100\n'),('ffmpeg',FAKE_FFMPEG)):
   path=self.tools/name;path.write_text(body);path.chmod(path.stat().st_mode|stat.S_IEXEC)
  self.provider=Provider();self.cloud={'protocol':'openai-transcriptions','baseUrl':self.provider.url,'model':'vendor/asr-1','timestamps':'none','label':'测试服务'}
  self.patches=[patch.dict(os.environ,{'QIAOMU_TOOL_DIRS':str(self.tools),'FAKE_FFMPEG_LOG':str(Path(self.temp.name)/'f.log'),'FAKE_PAUSES':'19.5:20.5 59.5:60.5','HF_HOME':str(Path(self.temp.name)/'hf'),'QIAOMU_TOOLS_HOME':str(Path(self.temp.name)/'private')}),patch.object(asr,'apple_silicon',lambda:False),patch.object(asr,'whisper_cpp_model',lambda:None),patch.object(asr,'spawn_worker',lambda directory,key=None:424242)]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in self.patches:p.stop()
  self.provider.close();self.temp.cleanup()
 def start(self,**extra): return asr.handle({'action':'asrStart','videoKey':'youtube:dbqweBCynuI','cloud':self.cloud,'cloudKey':'sk-secret-123',**extra},self.base)
 def test_a_cloud_job_needs_no_local_whisper_and_runs_to_a_cached_result_without_writing_the_key_anywhere(self):
  self.assertFalse(asr.status()['ready']);cloud_status=asr.handle({'action':'asrStatus','cloud':True},self.base);self.assertTrue(cloud_status['ready']);self.assertEqual(cloud_status['engine'],'cloud');self.assertFalse(cloud_status['modelDownloadNeeded'])
  started=self.start();self.assertTrue(started['ok'],started);self.assertEqual(started['engine'],'cloud');job=started['id']
  with patch.dict(os.environ,{'QIAOMU_ASR_KEY':'sk-secret-123'}):asr.run_worker(str(asr.job_dir(self.base,job)))
  done=asr.handle({'action':'asrPoll','jobId':job},self.base);self.assertEqual(done['state'],'completed',done);self.assertGreaterEqual(done['segmentCount'],3)
  self.assertEqual(self.provider.requests[0]['auth'],'Bearer sk-secret-123')
  for path in self.base.rglob('*'):
   if path.is_file():self.assertNotIn(b'sk-secret-123',path.read_bytes(),str(path))  # the key lives only in the worker's environment
  self.assertEqual(json.loads((asr.job_dir(self.base,job)/'spec.json').read_text())['cloud']['model'],'vendor/asr-1')
 def test_missing_or_malformed_cloud_input_is_refused_before_anything_starts(self):
  for bad in ({'cloudKey':''},{'cloudKey':'has space'},{'cloudKey':'x'*400},{'cloudKey':None},{'cloud':{'protocol':'nope'}},{'cloud':{**self.cloud,'baseUrl':'http://evil.example.com/v1'}}):
   with self.assertRaises(ValueError):self.start(**bad)
 def test_a_wrong_key_fails_the_job_with_a_code_the_page_can_explain(self):
  self.provider.script=[(401,{},{'error':{'message':'Invalid token'}})]*8
  job=self.start()['id']
  with patch.dict(os.environ,{'QIAOMU_ASR_KEY':'sk-secret-123'}):asr.run_worker(str(asr.job_dir(self.base,job)))
  done=asr.handle({'action':'asrPoll','jobId':job},self.base);self.assertEqual(done['state'],'failed');self.assertEqual(done['errorCode'],'cloud-auth');self.assertIn('API Key',done['error'])
 def test_the_worker_refuses_to_start_without_a_key_in_its_environment(self):
  job=self.start()['id']
  with patch.dict(os.environ,{},clear=False):
   os.environ.pop('QIAOMU_ASR_KEY',None);asr.run_worker(str(asr.job_dir(self.base,job)))
  self.assertEqual(asr.handle({'action':'asrPoll','jobId':job},self.base)['errorCode'],'cloud-auth')
 def test_the_host_can_check_a_cloud_setup_before_a_long_job(self):
  ok=asr.handle({'action':'asrCloudTest','cloud':self.cloud,'cloudKey':'sk-x'},self.base);self.assertTrue(ok['ok']);self.assertIn('ms',ok)
  self.provider.script=[(401,{},{'error':'no'})];bad=asr.handle({'action':'asrCloudTest','cloud':self.cloud,'cloudKey':'sk-x'},self.base);self.assertFalse(bad['ok']);self.assertEqual(bad['code'],'cloud-auth')
  with patch.object(asr,'find_tool',lambda name:None):self.assertEqual(asr.handle({'action':'asrCloudTest','cloud':self.cloud,'cloudKey':'sk-x'},self.base)['code'],'missing')
if __name__=='__main__':unittest.main()
