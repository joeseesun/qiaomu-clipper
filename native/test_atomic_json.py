import json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import asr, host

class AtomicJSONTest(unittest.TestCase):
    def error(self, code):
        error = PermissionError('fixture file in use'); error.winerror = code; return error
    def test_transient_windows_conflicts_preserve_final_json(self):
        for module in (asr, host):
            for code in (5, 32, 33):
                with self.subTest(module=module.__name__, code=code), tempfile.TemporaryDirectory() as directory:
                    target=Path(directory)/'state.json';target.write_text('{"old":true}')
                    original=module.os.replace
                    with patch.object(module.sys, 'platform', 'win32'), patch.object(module.os,'replace',side_effect=[self.error(code),self.error(code),None]) as replace, patch.object(module.time,'sleep') as sleep:
                        # Actually commit on the last attempt, so final contents are verified.
                        count=[0]
                        def attempt(src, dst):
                            count[0]+=1
                            if count[0]<3: raise self.error(code)
                            original(src,dst)
                        replace.side_effect=attempt
                        module.atomic_json(target, {'state':'completed','segments':3})
                        self.assertEqual(replace.call_count,3);self.assertEqual(sleep.call_count,2)
                    self.assertEqual(json.loads(target.read_text()),{'state':'completed','segments':3})
                    self.assertEqual(list(Path(directory).iterdir()),[target])
    def test_exhaustion_and_other_errors_propagate_and_clean_up(self):
        for module in (asr, host):
            for platform,error in [('win32',self.error(5)),('win32',self.error(1314)),('darwin',self.error(5)),('win32',OSError('disk full'))]:
                with self.subTest(module=module.__name__,platform=platform,error=error),tempfile.TemporaryDirectory() as directory:
                    target=Path(directory)/'state.json';target.write_text('{"old":true}')
                    with patch.object(module.sys,'platform',platform),patch.object(module.os,'replace',side_effect=error) as replace,patch.object(module.time,'sleep'):
                        with self.assertRaises(type(error)): module.atomic_json(target,{'state':'completed'})
                        self.assertLessEqual(replace.call_count,40)
                        if platform!='win32' or getattr(error,'winerror',None) not in (5,32,33): self.assertEqual(replace.call_count,1)
                    self.assertEqual(json.loads(target.read_text()),{'old':True});self.assertEqual(list(Path(directory).iterdir()),[target])
    def test_failed_progress_write_does_not_throttle_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory);asr.atomic_json(target/'state.json',{'stage':'download','progress':1});asr._last_write.clear()
            with patch.object(asr,'atomic_json',side_effect=OSError('disk full')),patch.object(asr.time,'time',return_value=100):
                with self.assertRaises(OSError): asr.write_state(target,stage='download',progress=2)
            with patch.object(asr.time,'time',return_value=100.1):asr.write_state(target,stage='download',progress=2)
            self.assertEqual(asr.read_state(target)['progress'],2)
    def test_readers_never_observe_a_partial_commit(self):
        import threading
        for module in (asr,host):
            with tempfile.TemporaryDirectory() as directory:
                target=Path(directory)/'state.json';module.atomic_json(target,{'n':0});done=threading.Event();invalid=[]
                def poll():
                    while not done.is_set():
                        try:
                            with target.open(encoding='utf8') as file:json.load(file)
                        except PermissionError:pass  # A reader may lose a transient Windows sharing race.
                        except Exception as error:invalid.append(error)
                thread=threading.Thread(target=poll);thread.start()
                try:
                    for n in range(100):module.atomic_json(target,{'n':n,'state':'completed' if n==99 else 'downloading'})
                finally:done.set();thread.join()
                self.assertFalse(invalid);self.assertEqual(json.loads(target.read_text()),{'n':99,'state':'completed'})
