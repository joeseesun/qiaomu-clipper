"""Native picker cancellation, Unicode and window cleanup across platforms."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('dialog_host',Path(__file__).with_name('host.py'))
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)

class DialogTests(unittest.TestCase):
 def setUp(self):
  self.window=Mock();self.dialog=Mock();self.tk=SimpleNamespace(Tk=Mock(return_value=self.window),filedialog=self.dialog)
  self.modules=patch.dict('sys.modules',{'tkinter':self.tk,'tkinter.filedialog':self.dialog});self.modules.start()
  self.platform=patch.object(host.sys,'platform','win32');self.platform.start()
 def tearDown(self): self.platform.stop();self.modules.stop()
 def test_windows_multi_selection_keeps_unicode_and_spaces(self):
  selected=('C:/笔记/中文 file.png','D:/视频/片段.mp4');self.dialog.askopenfilenames.return_value=selected
  self.assertEqual(host.pick_files(),list(selected));self.window.attributes.assert_called_once_with('-topmost',True)
  self.assertIs(self.dialog.askopenfilenames.call_args.kwargs['parent'],self.window);self.window.destroy.assert_called_once()
 def test_cancel_returns_no_files_and_closes_hidden_window(self):
  self.dialog.askopenfilenames.return_value=();self.assertIsNone(host.pick_files());self.window.destroy.assert_called_once()
 def test_error_closes_window_and_keeps_original_cause(self):
  cause=RuntimeError('Tk failed');self.dialog.askopenfilenames.side_effect=cause
  with self.assertRaises(ValueError) as result:host.pick_files()
  self.assertIs(result.exception.__cause__,cause);self.window.destroy.assert_called_once()
 def test_vault_picker_uses_parent_and_cancel_does_not_choose_home(self):
  self.dialog.askdirectory.return_value='';self.assertIsNone(host.choose_vault('D:/vault'))
  self.assertEqual(self.dialog.askdirectory.call_args.kwargs['initialdir'],'D:/vault')
  self.assertTrue(self.dialog.askdirectory.call_args.kwargs['mustexist']);self.window.destroy.assert_called_once()

if __name__=='__main__':unittest.main()
