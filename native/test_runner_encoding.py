import unittest, os, subprocess, sys
from pathlib import Path
from unittest.mock import Mock, patch
import asr_runner as runner


class RunnerEncodingTests(unittest.TestCase):
    def test_windows_pipes_use_utf8_for_non_ascii_subtitles(self):
        out, err = Mock(), Mock()
        with patch.object(runner.sys, 'platform', 'win32'), patch.object(runner.sys, 'stdout', out), patch.object(runner.sys, 'stderr', err):
            runner.configure_output()
        out.reconfigure.assert_called_once_with(encoding='utf-8', errors='replace')
        err.reconfigure.assert_called_once_with(encoding='utf-8', errors='replace')

    def test_non_windows_streams_are_unchanged(self):
        out, err = Mock(), Mock()
        with patch.object(runner.sys, 'platform', 'darwin'), patch.object(runner.sys, 'stdout', out), patch.object(runner.sys, 'stderr', err):
            runner.configure_output()
        out.reconfigure.assert_not_called()
        err.reconfigure.assert_not_called()

    def test_one_non_configurable_stream_does_not_block_the_other(self):
        err = Mock()
        with patch.object(runner.sys, 'platform', 'win32'), patch.object(runner.sys, 'stdout', object()), patch.object(runner.sys, 'stderr', err):
            runner.configure_output()
        err.reconfigure.assert_called_once_with(encoding='utf-8', errors='replace')

    def test_windows_runner_emits_utf8_under_an_ascii_parent_environment(self):
        result = subprocess.run([sys.executable, '-c', "import sys, asr_runner as r; sys.platform='win32'; r.configure_output(); r.emit(0, 1, '\u4e2d\u6587')"], cwd=Path(__file__).parent, env={**os.environ, 'PYTHONIOENCODING': 'ascii'}, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('中文', result.stdout.decode('utf-8'))
