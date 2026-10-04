import datetime, hashlib, importlib.util, json, os, tempfile, unittest, uuid
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('learning_host',Path(__file__).with_name('host.py'));host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)

class LearningDiaryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.vault=self.base/'vault';(self.vault/'.obsidian').mkdir(parents=True);self.state=self.base/'state';self.state.mkdir();self.config={'vault':str(self.vault)}
  self.configure({'folder':'Daily','format':'YYYY-MM-DD'})
 def tearDown(self): self.temp.cleanup()
 def configure(self,data): (self.vault/'.obsidian/daily-notes.json').write_text(json.dumps(data))
 def target(self):return host.handle({'action':'learningDailyTarget','vault':'vault'},self.config,self.state)
 def payload(self,content='### 视频与阅读笔记\n\n我的理解：学习中文 🙂\n\n原文摘录：Hello'):
  return {'action':'saveLearning','captureId':str(uuid.uuid4()),'content':content,'vault':'vault','expectedTargetToken':self.target()['targetToken']}
 def save(self,p): return host.handle(p,self.config,self.state)
 def path(self,result):return self.vault/result['relativePath']
 def test_append_keeps_frontmatter_and_existing_contents_and_retry_is_idempotent(self):
  p=self.payload();path=self.vault/self.target()['relativePath'];path.parent.mkdir();original='---\ntags: [day]\n---\n\n原有正文';path.write_text(original)
  r=self.save(p);self.assertEqual(r['status'],'saved');self.assertTrue(path.read_text().startswith(original));self.assertEqual(path.read_text().count(p['content']),1)
  duplicate=self.save(p);self.assertTrue(duplicate['duplicate']);self.assertEqual(path.read_text().count(p['content']),1)
  other=self.save(self.payload(p['content']));self.assertEqual(other['status'],'saved');self.assertEqual(path.read_text().count(p['content']),2)
 def test_template_complex_format_missing_config_and_vault_are_blocked(self):
  for data in [{'template':'Templates/Daily'},{'format':'dddd, MMMM D'},{'folder':'../escape'}]:
   self.configure(data);self.assertEqual(self.target()['status'],'unsupported')
  (self.vault/'.obsidian/daily-notes.json').unlink();self.assertEqual(self.target()['status'],'unsupported')
  with self.assertRaises(ValueError): host.handle({'action':'learningDailyTarget','vault':'wrong'},self.config,self.state)
  self.assertFalse((self.base/'escape').exists())
 def test_nested_numeric_format_new_note_unicode_and_long_quote(self):
  self.configure({'folder':'10 Daily','format':'YYYY/MM/DD'});p=self.payload('中文🙂'*20000);r=self.save(p)
  self.assertEqual(r['status'],'saved');self.assertEqual(r['relativePath'],'10 Daily/'+datetime.datetime.now().strftime('%Y/%m/%d')+'.md');self.assertIn(p['content'],self.path(r).read_text())
 def test_receipt_failure_recovers_marked_entry_without_duplicate_even_next_day(self):
  p=self.payload();original=host.atomic_json;calls=0
  def failing(path,data):
   nonlocal calls
   calls+=1
   if calls==2:raise OSError('simulated receipt crash')
   original(path,data)
  with patch.object(host,'atomic_json',failing): r=self.save(p)
  self.assertEqual(r['status'],'unconfirmed')
  class Tomorrow(datetime.datetime):
   @classmethod
   def now(cls): return datetime.datetime.now()+datetime.timedelta(days=1)
  with patch.object(host.datetime,'datetime',Tomorrow): recovered=self.save(p)
  self.assertEqual(recovered['status'],'saved');self.assertTrue(recovered['duplicate']);self.assertEqual(self.path(recovered).read_text().count(p['content']),1)
 def test_changed_target_requires_reconfirmation_and_writes_nothing(self):
  p=self.payload();self.configure({'folder':'Other','format':'YYYY-MM-DD'});r=self.save(p);self.assertEqual(r['status'],'target-changed');self.assertFalse(list(self.vault.rglob('*.md')))
 def test_same_id_with_other_content_is_not_appended(self):
  p=self.payload();r=self.save(p);self.assertEqual(self.save({**p,'content':'different'})['status'],'unconfirmed')
 def test_external_concurrent_append_survives_single_append_write(self):
  p=self.payload();path=self.vault/self.target()['relativePath'];path.parent.mkdir();path.write_text('original')
  original_write=host.os.write
  def external(fd,data):
   with path.open('a') as f:f.write('\nexternal edit')
   return original_write(fd,data)
  with patch.object(host.os,'write',external): r=self.save(p)
  self.assertEqual(r['status'],'saved');self.assertIn('external edit',path.read_text());self.assertTrue(path.read_text().startswith('original'))
 def test_external_atomic_replacement_is_not_overwritten_or_reported_as_saved(self):
  p=self.payload();path=self.vault/self.target()['relativePath'];original_write=host.os.write
  def replacing(fd,data):
   replacement=path.with_suffix('.tmp');replacement.write_text('EXTERNAL replacement');os.replace(replacement,path);return original_write(fd,data)
  with patch.object(host.os,'write',replacing):r=self.save(p)
  self.assertEqual(r['status'],'unconfirmed');self.assertEqual(path.read_text(),'EXTERNAL replacement')
  self.assertEqual(self.save(p)['status'],'unconfirmed');self.assertEqual(path.read_text(),'EXTERNAL replacement')
 def test_invalid_id_oversized_and_symlink_target_do_not_write(self):
  p=self.payload();self.assertEqual(self.save({**p,'captureId':'../../evil'})['status'],'failed');self.assertEqual(self.save({**p,'content':'x'*(host.MAX_BYTES+1)})['status'],'failed')
  outside=self.base/'outside.md';outside.write_text('outside');path=self.vault/self.target()['relativePath'];path.parent.mkdir();path.symlink_to(outside)
  self.assertEqual(self.save(p)['status'],'failed');self.assertEqual(outside.read_text(),'outside')
 def test_midnight_before_first_write_changes_target_without_touching_files(self):
  p=self.payload();today=datetime.datetime.now()
  class Tomorrow(datetime.datetime):
   @classmethod
   def now(cls):return today+datetime.timedelta(days=1)
  with patch.object(host.datetime,'datetime',Tomorrow):r=self.save(p)
  self.assertEqual(r['status'],'target-changed');self.assertFalse(list(self.vault.rglob('*.md')))
 def test_two_concurrent_records_preserve_both_entries(self):
  from concurrent.futures import ThreadPoolExecutor
  a,b=self.payload('first record'),self.payload('second record')
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(self.save,[a,b]))
  self.assertTrue(all(r['status']=='saved' for r in results));text=self.path(results[0]).read_text();self.assertEqual(text.count('first record'),1);self.assertEqual(text.count('second record'),1)
 def test_permission_error_before_append_does_not_modify_existing_note(self):
  p=self.payload();path=self.vault/self.target()['relativePath'];path.parent.mkdir();path.write_text('unchanged')
  original_open=host.os.open
  def denied(target,*args,**kwargs):
   if Path(target).resolve()==path.resolve():raise PermissionError('denied')
   return original_open(target,*args,**kwargs)
  with patch.object(host.os,'open',denied):
   with self.assertRaises(PermissionError):self.save(p)
  self.assertEqual(path.read_text(),'unchanged');self.assertEqual(self.save(p)['status'],'saved')

 def test_pending_before_write_after_midnight_requires_new_target_confirmation(self):
  p=self.payload();original_open=host.os.open;today=datetime.datetime.now()
  def denied(target,*args,**kwargs):
   if str(target).endswith('.md'):raise PermissionError('interrupted before append')
   return original_open(target,*args,**kwargs)
  with patch.object(host.os,'open',denied):
   with self.assertRaises(PermissionError):self.save(p)
  class Tomorrow(datetime.datetime):
   @classmethod
   def now(cls):return today+datetime.timedelta(days=1)
  with patch.object(host.datetime,'datetime',Tomorrow):
   r=self.save(p);self.assertEqual(r['status'],'target-changed');self.assertFalse(list(self.vault.rglob('*.md')))
   r=self.save({**p,'expectedTargetToken':r['target']['targetToken']})
  self.assertEqual(r['status'],'saved');self.assertEqual(self.path(r).read_text().count(p['content']),1)

 def test_entries_carry_no_marker_comments(self):
  p=self.payload();r=self.save(p);text=self.path(r).read_text();self.assertNotIn('<!--',text);self.assertNotIn('%%',text);self.assertEqual(text,'\n\n'+p['content'].rstrip()+'\n')
 def test_crash_after_write_is_recognised_even_after_the_user_edited_elsewhere(self):
  p=self.payload();path=self.vault/self.target()['relativePath'];path.parent.mkdir();path.write_text('original')
  original=host.atomic_json;calls=0
  def failing(target,data):
   nonlocal calls
   calls+=1
   if calls==2:raise OSError('simulated receipt crash')
   original(target,data)
  with patch.object(host,'atomic_json',failing): self.assertEqual(self.save(p)['status'],'unconfirmed')
  path.write_text(path.read_text()+'\nlater external line')
  r=self.save(p);self.assertTrue(r['duplicate']);self.assertEqual(path.read_text().count(p['content']),1)
 def test_pending_write_that_never_happened_is_retried_and_an_edited_original_is_not_touched(self):
  p=self.payload();path=self.vault/self.target()['relativePath'];path.parent.mkdir();path.write_text('original');original_open=host.os.open
  def denied(target,*args,**kwargs):
   if str(target).endswith('.md'):raise PermissionError('interrupted before append')
   return original_open(target,*args,**kwargs)
  with patch.object(host.os,'open',denied):
   with self.assertRaises(PermissionError):self.save(p)
  path.write_text('rewritten by someone else');self.assertEqual(self.save(p)['status'],'unconfirmed');self.assertEqual(path.read_text(),'rewritten by someone else')
  path.write_text('original');self.assertEqual(self.save(p)['status'],'saved');self.assertEqual(path.read_text().count(p['content']),1)
