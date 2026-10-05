import importlib.util, json, os, stat, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import asr
spec=importlib.util.spec_from_file_location('asr_host',HERE/'host.py');host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)

KEY='bilibili:BV1hM4m1U7rA:20'
FAKE_YTDLP='''#!/bin/bash
# fake yt-dlp: honours -o and fails on request
out=""; while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; if [ "$1" = "--cookies-from-browser" ]; then echo "cookies=$2" >> "$FAKE_LOG"; fi; last="$1"; shift; done
[ -n "$FAKE_NEEDS_LOGIN" ] && [ ! -s "$FAKE_LOG" ] && { echo "ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser" >&2; exit 1; }
[ -n "$FAKE_YTDLP_FAIL" ] && { echo "ERROR: $FAKE_YTDLP_FAIL" >&2; exit 1; }
echo "[download]  50.0% of 1MiB"; echo "[download] 100.0% of 1MiB"
printf 'audio' > "${out/\\%(ext)s/m4a}"
'''
FAKE_FFPROBE='#!/bin/bash\necho "${FAKE_DURATION:-120.5}"\n'
FAKE_FFMPEG='#!/bin/bash\nfor a in "$@"; do last="$a"; done\nprintf wav > "$last"\n'
FAKE_MLX='''#!/bin/bash
dir=""; while [ $# -gt 0 ]; do if [ "$1" = "--output-dir" ]; then dir="$2"; fi; if [ "$1" = "--language" ]; then echo "lang=$2" >> "$FAKE_LOG"; fi; if [ "$1" = "--initial-prompt" ]; then echo "prompt=$2" >> "$FAKE_LOG"; fi; shift; done
[ -n "$FAKE_MLX_FAIL" ] && { echo "boom" >&2; exit 2; }
echo "[00:00.000 --> 00:04.840] 好了,下面继续。"
echo "[00:04.900 --> 00:08.000] 谢谢观看"
echo "[00:08.000 --> 00:12.000] 第三个部分。"
echo "[01:00:00.500 --> 01:00:03.000] 一小时之后。"
printf '{"language":"zh","segments":[{"start":0.0,"end":4.84,"text":"好了,下面继续。"},{"start":4.9,"end":8.0,"text":"谢谢观看"},{"start":8.0,"end":12.0,"text":"第三个部分。"},{"start":3600.5,"end":3603.0,"text":"一小时之后。"}]}' > "$dir/whisper.json"
'''
class AsrTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)/'state';self.base.mkdir();self.tools=Path(self.temp.name)/'tools';self.tools.mkdir()
  for name,body in (('yt-dlp',FAKE_YTDLP),('ffprobe',FAKE_FFPROBE),('ffmpeg',FAKE_FFMPEG),('mlx_whisper',FAKE_MLX)):
   path=self.tools/name;path.write_text(body);path.chmod(path.stat().st_mode|stat.S_IEXEC)
  self.log=Path(self.temp.name)/'calls.log'
  self.patches=[patch.dict(os.environ,{'QIAOMU_TOOL_DIRS':str(self.tools),'FAKE_LOG':str(self.log),'HF_HOME':str(Path(self.temp.name)/'hf'),'QIAOMU_TOOLS_HOME':str(Path(self.temp.name)/'private')}),patch.object(asr,'apple_silicon',lambda:True),patch.object(asr,'mlx_model_ready',lambda:True),patch.object(asr,'whisper_cpp_model',lambda:None),patch.object(asr,'spawn_worker',lambda directory,key=None:424242)]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in self.patches:p.stop()
  self.temp.cleanup()
 def run_job(self,**extra):
  r=asr.handle({'action':'asrStart','videoKey':KEY,**extra},self.base);self.assertTrue(r['ok'],r);return r
 def work(self,job_id):
  asr.run_worker(str(asr.job_dir(self.base,job_id)))
  return asr.handle({'action':'asrPoll','jobId':job_id},self.base)
 def test_status_reports_tools_engine_and_install_hints(self):
  s=asr.handle({'action':'asrStatus'},self.base);self.assertTrue(s['ready']);self.assertEqual(s['engine'],'mlx');self.assertFalse(s['modelDownloadNeeded'])
  with patch.dict(os.environ,{'QIAOMU_TOOL_DIRS':''}),patch.object(asr,'TOOL_DIRS',[]),patch.dict(os.environ,{'PATH':'/nonexistent'}):
   s=asr.status();self.assertFalse(s['ready']);self.assertEqual(set(s['missing']),{'yt-dlp','ffmpeg','whisper'});self.assertTrue(any('brew install' in h for h in s['hints']))
 def test_full_pipeline_streams_segments_drops_invented_lines_and_caches_the_result(self):
  started=self.run_job();self.assertIn(started['state'],('queued','downloading'));job=started['id']
  done=self.work(job)
  self.assertEqual(done['state'],'completed',done);self.assertEqual(done['progress'],100);self.assertEqual(done['language'],'zh')
  self.assertEqual([s['text'] for s in done['segments']],['好了,下面继续。','第三个部分。','一小时之后。'])  # the made-up "谢谢观看" is gone
  self.assertEqual(done['segments'][2]['start'],3600.5);self.assertEqual(done['segmentCount'],3)
  self.assertFalse(list(asr.job_dir(self.base,job).glob('audio.*')))  # the audio is deleted when the job ends
  again=asr.handle({'action':'asrStart','videoKey':KEY},self.base);self.assertEqual(again['state'],'completed');self.assertTrue(again['cached']);self.assertEqual(len(again['segments']),3)
 def test_poll_returns_only_what_is_new(self):
  job=self.run_job()['id'];self.work(job)
  first=asr.handle({'action':'asrPoll','jobId':job,'since':0},self.base);self.assertEqual(first['next'],3)
  rest=asr.handle({'action':'asrPoll','jobId':job,'since':2},self.base);self.assertEqual([s['text'] for s in rest['segments']],['一小时之后。'])
 def test_language_is_passed_and_checked(self):
  self.work(self.run_job(language='en')['id']);self.assertIn('lang=en',self.log.read_text())
  with self.assertRaises(ValueError):asr.handle({'action':'asrStart','videoKey':KEY,'language':'xx;rm'},self.base)
 def test_a_chinese_prompt_is_only_used_when_chinese_was_asked_for(self):
  for language in ('auto','en'):
   self.log.write_text('');self.work(self.run_job(language=language)['id']);self.assertNotIn('prompt=',self.log.read_text(),language);asr.cancel(self.base,{'jobId':asr.active_job(self.base)[0] or 'x'})
   for entry in list((self.base/'asr'/'results').glob('*.json')):entry.unlink()
  self.log.write_text('');self.work(self.run_job(language='zh')['id']);self.assertIn('prompt=以下是普通话的句子。',self.log.read_text())
 def test_results_cached_by_an_older_recipe_are_not_reused(self):
  job=self.run_job()['id'];self.work(job);path=asr.result_path(self.base,KEY);data=json.loads(path.read_text());self.assertEqual(data['version'],asr.RESULT_VERSION)
  data['version']=1;data['segments']=[{'start':0,'end':1,'text':'老的错误结果'}];path.write_text(json.dumps(data))
  fresh=asr.handle({'action':'asrStart','videoKey':KEY},self.base);self.assertNotEqual(fresh.get('cached'),True);self.assertNotEqual(fresh['state'],'completed')
 def test_only_known_video_keys_are_accepted_and_the_url_is_built_by_the_host(self):
  self.assertEqual(asr.video_url('youtube:dbqweBCynuI'),'https://www.youtube.com/watch?v=dbqweBCynuI');self.assertEqual(asr.video_url(KEY),'https://www.bilibili.com/video/BV1hM4m1U7rA/?p=20')
  for bad in ('https://evil.example.com/x','youtube:short','bilibili:BV1:2','youtube:dbqweBCynuI; rm -rf ~','',None,'file:///etc/passwd'):
   with self.assertRaises(ValueError):asr.video_url(bad)
 def test_missing_tools_are_reported_instead_of_starting(self):
  with patch.object(asr,'find_tool',lambda name:None):
   r=asr.handle({'action':'asrStart','videoKey':KEY},self.base);self.assertFalse(r['ok']);self.assertEqual(r['error'],'missing');self.assertIn('yt-dlp',r['missing'])
 def test_download_and_recognition_failures_surface_a_readable_error(self):
  with patch.dict(os.environ,{'FAKE_YTDLP_FAIL':'Video unavailable'}):
   done=self.work(self.run_job()['id']);self.assertEqual(done['state'],'failed');self.assertIn('Video unavailable',done['error']);self.assertIn('下载',done['error'])
  asr.cancel(self.base,{'jobId':done['id']})
  with patch.dict(os.environ,{'FAKE_MLX_FAIL':'1'}):
   done=self.work(self.run_job()['id']);self.assertEqual(done['state'],'failed');self.assertIn('识别失败',done['error']);self.assertFalse(list(asr.job_dir(self.base,done['id']).glob('audio.*')))
 def test_a_login_wall_is_reported_as_a_code_and_cookies_are_used_only_when_asked_for_and_allowed(self):
  with patch.dict(os.environ,{'FAKE_NEEDS_LOGIN':'1'}):
   first=self.work(self.run_job()['id']);self.assertEqual(first['state'],'failed');self.assertEqual(first['errorCode'],'needs-cookies');self.assertFalse(self.log.exists() and 'cookies=' in self.log.read_text())  # never read without being asked
   asr.cancel(self.base,{'jobId':first['id']})
   retry=self.work(self.run_job(cookies='chrome')['id']);self.assertEqual(retry['state'],'completed',retry);self.assertIn('cookies=chrome',self.log.read_text())
  with self.assertRaises(ValueError):asr.handle({'action':'asrStart','videoKey':KEY,'cookies':'chrome; rm -rf ~'},self.base)
  with self.assertRaises(ValueError):asr.handle({'action':'asrStart','videoKey':KEY,'cookies':'/etc/passwd'},self.base)
 def test_a_video_longer_than_the_limit_is_refused(self):
  with patch.dict(os.environ,{'FAKE_DURATION':str(asr.MAX_DURATION+10)}):
   done=self.work(self.run_job()['id']);self.assertEqual(done['state'],'failed');self.assertIn('小时',done['error'])
 def test_only_one_job_runs_at_a_time_and_the_same_video_is_joined(self):
  job=self.run_job()['id'];asr.write_state(asr.job_dir(self.base,job),state='transcribing',pid=os.getpid())
  with patch.object(asr,'pid_alive',lambda pid:True):
   same=asr.handle({'action':'asrStart','videoKey':KEY},self.base);self.assertEqual(same['id'],job)
   other=asr.handle({'action':'asrStart','videoKey':'youtube:dbqweBCynuI'},self.base);self.assertFalse(other['ok']);self.assertEqual(other['error'],'busy');self.assertEqual(other['jobId'],job)
 def test_a_dead_worker_does_not_stay_running_and_a_cancel_never_signals_a_stranger(self):
  job=self.run_job()['id'];asr.write_state(asr.job_dir(self.base,job),state='transcribing',pid=2**22+12345)
  p=asr.handle({'action':'asrPoll','jobId':job},self.base);self.assertEqual(p['state'],'failed');self.assertIn('意外退出',p['error'])
  job=self.run_job()['id'];asr.write_state(asr.job_dir(self.base,job),state='transcribing',pid=os.getpid())  # alive, but not an asr worker
  with patch.object(asr.os,'killpg') as kill:
   c=asr.handle({'action':'asrCancel','jobId':job},self.base);self.assertFalse(kill.called);self.assertEqual(c['state'],'failed')
 def test_cancel_stops_the_worker_group_and_marks_the_job(self):
  job=self.run_job()['id'];asr.write_state(asr.job_dir(self.base,job),state='transcribing',pid=4242)
  alive=iter([True,True,False,False,False,False])
  with patch.object(asr,'pid_alive',lambda pid:next(alive,False)),patch.object(asr.os,'killpg') as kill,patch.object(asr.time,'sleep'):
   c=asr.handle({'action':'asrCancel','jobId':job},self.base)
  self.assertTrue(kill.called);self.assertEqual(c['state'],'cancelled')
 def test_job_ids_are_validated_and_old_jobs_are_pruned(self):
  for bad in ('../../etc','x','',None,'g'*32): self.assertFalse(asr.handle({'action':'asrPoll','jobId':bad},self.base)['ok'])
  job=self.run_job()['id'];self.work(job);directory=asr.job_dir(self.base,job);old=time.time()-asr.JOB_KEEP_SECONDS-60;os.utime(directory,(old,old))
  asr.prune(self.base);self.assertFalse(directory.exists())
 def test_parser_reads_both_stamp_styles_and_ignores_noise(self):
  self.assertEqual(asr.parse_line('[00:04.900 --> 00:08.000]  你好'),{'start':4.9,'end':8.0,'text':'你好'})
  self.assertEqual(asr.parse_line('[01:02:03.500 --> 01:02:04.000] x')['start'],3723.5)
  for noise in ('Fetching 4 files: 100%','','[00:01.000 --> 00:02.000]','Args: {}'):self.assertIsNone(asr.parse_line(noise))
 def test_cleaning_collapses_a_stuck_repeat_and_keeps_real_short_lines(self):
  seg=lambda t,a=0,b=2:{'start':a,'end':b,'text':t}
  out=asr.clean_segments([seg('好'),seg('好'),seg('好'),seg('好'),seg('谢谢你的帮助',0,3),seg('字幕由某某提供',0,3),seg('Thanks for watching',0,2),seg('我想说谢谢观看这个功能',0,20)])
  self.assertEqual([s['text'] for s in out],['好','好','谢谢你的帮助','我想说谢谢观看这个功能'])
 def test_the_host_routes_asr_actions_without_a_vault(self):
  s=host.handle({'action':'asrStatus'},{},self.base);self.assertTrue(s['ok']);self.assertIn('ready',s)
 def upload(self,data,name='talk.mp3',chunk=7):
  start=asr.handle({'action':'asrUploadStart','name':name,'size':len(data)},self.base);self.assertTrue(start['ok'],start)
  import base64
  for i in range(0,len(data),chunk):self.assertTrue(asr.handle({'action':'asrUploadChunk','uploadId':start['uploadId'],'index':i//chunk,'data':base64.b64encode(data[i:i+chunk]).decode()},self.base)['ok'])
  return asr.handle({'action':'asrUploadFinish','uploadId':start['uploadId']},self.base)
 def test_a_chosen_file_is_uploaded_in_pieces_named_by_its_content_and_transcribed(self):
  data=b'0123456789abcdefghij'*5;done=self.upload(data,name='talk.wav');self.assertTrue(done['ok']);self.assertRegex(done['key'],r'^file:[0-9a-f]{32}$')
  self.assertEqual(self.upload(data)['key'],done['key'])  # the same file is the same key
  r=asr.handle({'action':'asrStart','videoKey':done['key']},self.base);self.assertTrue(r['ok'],r);final=self.work(r['id'])
  self.assertEqual(final['state'],'completed',final);self.assertEqual(len(final['segments']),3)
  self.assertTrue(asr.staged_file(self.base,done['key']).is_file())  # the original is kept for next time; only the job's copy is deleted
  self.assertEqual(asr.handle({'action':'asrStart','videoKey':'file:'+'0'*32},self.base)['error'],'file-missing')
 def test_uploads_are_checked(self):
  for bad in ({'name':'x.exe','size':5},{'name':'x.mp3','size':0},{'name':'x.mp3','size':'5'},{'name':'x.mp3','size':5*1024**4}):
   with self.assertRaises(ValueError):asr.handle({'action':'asrUploadStart',**bad},self.base)
  start=asr.handle({'action':'asrUploadStart','name':'a.wav','size':4},self.base)
  import base64
  for message in ({'uploadId':'../x','index':0,'data':''},{'uploadId':start['uploadId'],'index':3,'data':base64.b64encode(b'ab').decode()},{'uploadId':start['uploadId'],'index':0,'data':'!!'},{'uploadId':start['uploadId'],'index':0,'data':base64.b64encode(b'abcde').decode()}):
   with self.assertRaises(ValueError):asr.handle({'action':'asrUploadChunk',**message},self.base)
  with self.assertRaises(ValueError):asr.handle({'action':'asrUploadFinish','uploadId':start['uploadId']},self.base)  # nothing was sent
 def test_a_podcast_episode_is_downloaded_from_its_own_media_host_only(self):
  page='<meta property="og:audio" content="https://media.xyzcdn.net/a/b.m4a"/>'
  with patch.object(asr,'fetch_bytes',lambda url,**k:page.encode()):self.assertEqual(asr.podcast_audio_url('https://www.xiaoyuzhoufm.com/episode/'+'a'*24),'https://media.xyzcdn.net/a/b.m4a')
  for bad in ('https://evil.example/x.m4a','http://media.xyzcdn.net/x.m4a','https://xyzcdn.net.evil.example/x.m4a'):
   with patch.object(asr,'fetch_bytes',lambda url,**k:('<meta property="og:audio" content="%s"/>'%bad).encode()),self.assertRaises(asr.Failed):asr.podcast_audio_url('x')
  with patch.object(asr,'fetch_bytes',lambda url,**k:b'<html></html>'),self.assertRaises(asr.Failed):asr.podcast_audio_url('x')
  self.assertEqual(asr.video_url('xiaoyuzhou:'+'a'*24),'https://www.xiaoyuzhoufm.com/episode/'+'a'*24)
  for bad in ('xiaoyuzhou:abc','xiaoyuzhou:'+'g'*24,'file:xyz'):
   with self.assertRaises(ValueError):asr.video_url(bad)
if __name__=='__main__':unittest.main()
