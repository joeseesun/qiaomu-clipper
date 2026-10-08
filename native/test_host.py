import datetime, importlib.util, json, struct, subprocess, sys, tempfile, unittest, uuid
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('clipper_host',Path(__file__).with_name('host.py'));host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
class NativeSaveTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name).resolve();self.vault=self.base/'vault';(self.vault/'.obsidian').mkdir(parents=True);self.config={'vault':str(self.vault),'origin':'chrome-extension://dimdmejdckinolccdkoffhckhmoepdea/'};self.state=self.base/'state';self.state.mkdir()
 def tearDown(self):self.temp.cleanup()
 def payload(self,**extra):return {'action':'save','requestId':str(uuid.uuid4()),'content':'---\ntitle: 中文\n---\n\n剪藏 **正文**','name':'中文.md','folder':'Clippings','vault':'vault','behavior':'create',**extra}
 def save(self,p):return host.handle(p,self.config,self.state)
 def test_save_collision_and_retry(self):
  p=self.payload();r=self.save(p);self.assertEqual(Path(r['path']).read_text(),p['content']);self.assertEqual(self.save(p)['path'],r['path']);self.assertTrue(self.save(p)['duplicate']);second=self.save(self.payload(content='第二篇'));self.assertEqual(second['relativePath'],'Clippings/中文 1.md');self.assertEqual(Path(r['path']).read_text(),p['content'])
 def test_append_prepend_overwrite(self):
  r=self.save(self.payload(content='A'));self.save(self.payload(content='B',behavior='append-specific'));self.save(self.payload(content='C',behavior='prepend-specific'));self.assertEqual(Path(r['path']).read_text(),'C\n\nA\n\nB');self.save(self.payload(content='D',behavior='overwrite'));self.assertEqual(Path(r['path']).read_text(),'D')
 def test_reject_escape_hidden_and_vault_mismatch(self):
  for p in [self.payload(folder='../outside'),self.payload(folder='/tmp'),self.payload(folder='.obsidian'),self.payload(name='../x.md'),self.payload(name='x.js'),self.payload(vault='other')]:
   with self.assertRaises(ValueError):self.save(p)
  outside=self.base/'outside';outside.mkdir();(self.vault/'link').symlink_to(outside,target_is_directory=True)
  with self.assertRaises(ValueError):self.save(self.payload(folder='link'))
  self.assertFalse(list(outside.iterdir()))
 def test_daily_uses_real_local_date_and_configured_folder(self):
  (self.vault/'.obsidian/daily-notes.json').write_text(json.dumps({'folder':'10 Daily','format':'YYYY-MM-DD'}));r=self.save(self.payload(behavior='append-daily'));self.assertEqual(r['relativePath'],'10 Daily/'+datetime.datetime.now().strftime('%Y-%m-%d')+'.md')
 def test_request_id_cannot_replace_other_content(self):
  p=self.payload();r=self.save(p)
  with self.assertRaises(ValueError):self.save({**p,'content':'changed'})
  self.assertEqual(Path(r['path']).read_text(),p['content'])
 def test_native_protocol_origin_and_utf8(self):
  script=self.state/'host.py';script.write_text(Path(__file__).with_name('host.py').read_text());(self.state/'config.json').write_text(json.dumps(self.config));p=self.payload();b=json.dumps(p,ensure_ascii=False).encode()
  def call(origin):
   r=subprocess.run([sys.executable,str(script),origin],input=struct.pack('=I',len(b))+b,capture_output=True,check=True);n=struct.unpack('=I',r.stdout[:4])[0];self.assertEqual(n,len(r.stdout[4:]));return json.loads(r.stdout[4:])
  self.assertFalse(call('chrome-extension://other/')['ok']);self.assertTrue(call(self.config['origin'])['ok']);self.assertEqual((self.vault/'Clippings/中文.md').read_text(),p['content'])
 def test_multiple_allowed_origins(self):
  script=self.state/'host.py';script.write_text(Path(__file__).with_name('host.py').read_text());(self.state/'config.json').write_text(json.dumps({'vault':str(self.vault),'origins':['chrome-extension://a/','chrome-extension://b/']}))
  b=json.dumps({'action':'status'}).encode()
  def ok(origin):
   r=subprocess.run([sys.executable,str(script),origin],input=struct.pack('=I',len(b))+b,capture_output=True,check=True);return json.loads(r.stdout[4:])['ok']
  self.assertTrue(ok('chrome-extension://a/'));self.assertTrue(ok('chrome-extension://b/'));self.assertFalse(ok('chrome-extension://c/'))
 def test_configure_then_retry_failed_clip_in_selected_vault(self):
  daily=self.base/'rockfish';(daily/'.obsidian').mkdir(parents=True);p=self.payload(vault='rockfish')
  with self.assertRaises(ValueError):self.save(p)
  result=self.save({'action':'configure','vaultPath':str(daily)});self.assertEqual(result['vault'],'rockfish')
  stored=json.loads((self.state/'config.json').read_text());self.assertEqual(stored['origin'],self.config['origin']);self.assertEqual(stored['vault'],str(daily))
  self.assertEqual(host.handle({'action':'status'},stored,self.state)['vaultPath'],str(daily))
  saved=host.handle(p,stored,self.state);self.assertEqual(Path(saved['path']).read_text(),p['content']);self.assertTrue(Path(saved['path']).is_relative_to(daily));self.assertFalse((self.vault/'Clippings').exists())
  with self.assertRaises(ValueError):host.handle(self.payload(),stored,self.state)
 def test_invalid_configuration_preserves_previous_target(self):
  (self.state/'config.json').write_text(json.dumps(self.config));before=(self.state/'config.json').read_text()
  for value in ['',None,'relative/vault',str(self.base),str(self.base/'missing'),'\x00']:
   with self.assertRaises(ValueError):self.save({'action':'configure','vaultPath':value})
   self.assertEqual((self.state/'config.json').read_text(),before);self.assertEqual(self.config['vault'],str(self.vault))
 def test_can_reconfigure_when_old_vault_removed(self):
  self.config['vault']=str(self.base/'removed');result=self.save({'action':'configure','vaultPath':str(self.vault)});self.assertTrue(result['ok'])
 def test_chooser_validates_directory_without_switching_target(self):
  daily=self.base/'other-vault';(daily/'.obsidian').mkdir(parents=True)
  with patch.object(host,'choose_vault',return_value=str(daily)):
   result=self.save({'action':'chooseVault'});self.assertEqual(result['vaultPath'],str(daily));self.assertEqual(self.config['vault'],str(self.vault));self.assertFalse((self.state/'config.json').exists())
  with patch.object(host,'choose_vault',return_value=None):self.assertEqual(self.save({'action':'chooseVault'}),{'ok':False,'cancelled':True})
  with patch.object(host,'choose_vault',return_value=str(self.base)):
   with self.assertRaises(ValueError):self.save({'action':'chooseVault'})
 def test_note_folder_picker_returns_relative_path_and_keeps_vault(self):
  folder=self.vault/'40 Resources/Clippings';folder.mkdir(parents=True)
  with patch.object(host,'choose_vault',return_value=str(folder)):
   result=self.save({'action':'chooseNoteFolder','vault':'vault','folder':'{{date}}'});self.assertEqual(result['folder'],'40 Resources/Clippings');self.assertEqual(self.config['vault'],str(self.vault))
  with patch.object(host,'choose_vault',return_value=str(self.vault)):self.assertEqual(self.save({'action':'chooseNoteFolder'})['folder'],'')
  with patch.object(host,'choose_vault',return_value=None):self.assertTrue(self.save({'action':'chooseNoteFolder'})['cancelled'])
 def test_note_folder_picker_rejects_outside_hidden_and_wrong_vault(self):
  outside=self.base/'outside';outside.mkdir();(self.vault/'escape').symlink_to(outside,target_is_directory=True)
  for folder in [outside,self.vault/'.obsidian',self.vault/'escape']:
   with patch.object(host,'choose_vault',return_value=str(folder)):
    with self.assertRaises(ValueError):self.save({'action':'chooseNoteFolder'})
  with patch.object(host,'choose_vault') as picker:
   with self.assertRaises(ValueError):self.save({'action':'chooseNoteFolder','vault':'other'})
   picker.assert_not_called()
 def test_helper_stays_connected_without_a_vault(self):
  empty={'origin':self.config['origin']}
  self.assertEqual(host.handle({'action':'status'},empty,self.state),{'ok':True,'vault':None})
  with self.assertRaises(ValueError):host.handle({'action':'learningDailyTarget'},empty,self.state)
 def test_lists_the_vaults_obsidian_knows_most_recent_first(self):
  home=self.base/'home';cfg=home/'Library/Application Support/obsidian';cfg.mkdir(parents=True)
  a=self.base/'A';b=self.base/'B';gone=self.base/'Gone'
  for v in (a,b):(v/'.obsidian').mkdir(parents=True)
  (cfg/'obsidian.json').write_text(json.dumps({'vaults':{'1':{'path':str(a),'ts':1},'2':{'path':str(b),'ts':5},'3':{'path':str(gone),'ts':9}}}))
  with patch.object(Path,'home',return_value=home):result=host.handle({'action':'listVaults'},{'vault':str(a)},self.state)
  self.assertEqual([v['name'] for v in result['vaults']],['B','A']);self.assertEqual(result['current'],str(a));self.assertTrue(result['ok'])
  with patch.object(Path,'home',return_value=self.base/'nowhere'):self.assertEqual(host.handle({'action':'listVaults'},{},self.state)['vaults'],[])
if __name__=='__main__':unittest.main()
