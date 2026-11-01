import copy
import io
import json
import os
from pathlib import Path
import queue
import select
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import codex_chat as chat
from codex_chat_policy import restricted_catalog, policy


class FakeRpc:
    calls = []
    def __init__(self, cwd, config, cancel):
        self.notes, self.events, self.cancel = [], queue.Queue(), cancel
    def initialize(self): pass
    def close(self): pass
    def send(self, data): self.calls.append(('send', data))
    def request(self, method, params):
        self.calls.append((method, params))
        if method == 'account/read': return {'account': {'type': 'chatgpt', 'email': 'test@example.com'}}
        if method == 'model/list': return {'data': [{'model': 'same-model', 'defaultReasoningEffort': 'high', 'supportedReasoningEfforts': [{'reasoningEffort': 'high'}]}]}
        if method in ('thread/start', 'thread/resume'): return {'thread': {'id': 'native-thread'}}
        if method == 'turn/start':
            self.notes += [{'method': 'item/completed', 'params': {'threadId': 'native-thread', 'turnId': 'turn', 'item': {'id': 'answer', 'type': 'agentMessage', 'text': 'answer'}}}, {'method': 'turn/completed', 'params': {'threadId': 'native-thread', 'turn': {'status': 'completed'}}}]
            return {'turn': {'id': 'turn'}}
        raise AssertionError(method)


@unittest.skipUnless(os.name == 'posix', 'Native Codex pipe/process integration requires POSIX; Windows is not supported.')
class ChatTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        (self.base / 'models_cache.json').write_text(json.dumps({'models': [{'slug': 'same-model', 'apply_patch_tool_type': 'freeform', 'multi_agent_version': 'v2'}]}))
        self.env = patch.object(chat, 'CODEX_DIR', self.base)
        self.env.start(); self.addCleanup(self.env.stop)
        FakeRpc.calls = []
        self.data = {'action': 'chat', 'namespace': 'scope', 'sessionId': 'session', 'accountEmail': 'test@example.com', 'model': 'same-model', 'effort': 'high', 'system': 'context', 'messages': [{'role': 'user', 'content': 'first'}]}
    def run_chat(self, data=None):
        events = []
        chat.run_request(data or self.data, events.append, threading.Event(), self.base / 'state', FakeRpc)
        return events
    def test_resume_preserves_native_tool_history_and_sends_only_new_input(self):
        self.run_chat()
        self.data['messages'] += [{'role': 'assistant', 'content': 'displayed answer and tool cards'}, {'role': 'user', 'content': 'follow up'}]
        result = self.run_chat()
        self.assertTrue(result[0]['resumed'])
        self.assertEqual([x for m, x in FakeRpc.calls if m == 'turn/start'][-1]['input'], [{'type': 'text', 'text': 'follow up'}])
        self.assertEqual(len([m for m, _ in FakeRpc.calls if m == 'thread/start']), 1)
        self.assertEqual(len([m for m, _ in FakeRpc.calls if m == 'thread/resume']), 1)
    def test_edited_history_or_different_profile_never_reuses_unrelated_thread(self):
        self.run_chat()
        self.data['messages'][0]['content'] = 'changed'
        self.assertFalse(self.run_chat()[0]['resumed'])
        self.data['namespace'] = 'other-scope'
        self.assertFalse(self.run_chat()[0]['resumed'])
    def test_account_and_model_and_effort_mismatch_fail_before_inference(self):
        for key, value in [('accountEmail', 'other@example.com'), ('model', 'unavailable'), ('effort', 'ultra')]:
            data = copy.deepcopy(self.data); data[key] = value
            with self.assertRaises(ValueError): self.run_chat(data)
        self.assertFalse(any(m == 'turn/start' for m, _ in FakeRpc.calls))
    def test_policy_removes_host_tools_without_changing_model_or_reasoning(self):
        model = {'slug': 'same-model', 'supported_reasoning_levels': [{'effort': 'high'}], 'apply_patch_tool_type': 'freeform', 'multi_agent_version': 'v2', 'experimental_supported_tools': ['clock', 'unsafe_tool']}
        result = restricted_catalog({'models': [model]})['models'][0]
        self.assertEqual(result['slug'], model['slug'])
        self.assertEqual(result['supported_reasoning_levels'], model['supported_reasoning_levels'])
        self.assertIsNone(result['apply_patch_tool_type'])
        self.assertEqual(result['multi_agent_version'], 'disabled')
        self.assertEqual(result['experimental_supported_tools'], ['clock'])
        (self.base / 'config.toml').write_text('[mcp_servers."computer-use"]\ncommand="test"\n[mcp_servers.docs]\nurl="https://example.com"')
        config = policy(self.base / 'catalog.json', True, self.base)
        self.assertFalse(config['mcp_servers.computer-use.enabled'])
        self.assertFalse(config['mcp_servers.docs.enabled'])
        self.assertFalse(config['features.shell_tool'])
        self.assertEqual(config['web_search'], 'live')
        self.assertEqual(policy(self.base / 'catalog.json', False, self.base)['web_search'], 'disabled')
    def test_rejects_arbitrary_paths_commands_and_oversized_native_frames(self):
        for data in [{'action': 'exec', 'cmd': 'test'}, {**self.data, 'sessionId': '../../x'}]:
            with self.assertRaises(ValueError): chat.validate_request(data)
        with self.assertRaises(ValueError): chat.read_native(io.BytesIO(struct.pack('<I', chat.MAX_INPUT + 1)))
        raw = json.dumps({'action': 'cancel'}).encode()
        self.assertEqual(chat.read_native(io.BytesIO(struct.pack('<I', len(raw)) + raw)), {'action': 'cancel'})
    def test_gui_uses_saved_proxy_but_never_overrides_an_explicit_runtime_proxy(self):
        (self.base / 'network.json').write_text(json.dumps({'https_proxy': 'http://127.0.0.1:7897', 'unrelated': 'must-not-copy'}))
        with patch.object(chat, '__file__', str(self.base / 'codex_chat.py')):
            with patch.dict(chat.os.environ, {}, clear=True):
                env = chat.runtime_environment('/test/bin/codex')
                self.assertEqual(env['https_proxy'], 'http://127.0.0.1:7897')
                self.assertNotIn('unrelated', env)
            with patch.dict(chat.os.environ, {'HTTPS_PROXY': 'http://127.0.0.1:8888'}, clear=True):
                env = chat.runtime_environment('/test/bin/codex')
                self.assertEqual(env['HTTPS_PROXY'], 'http://127.0.0.1:8888')
                self.assertNotIn('https_proxy', env)

    def test_pipe_reader_preserves_fragmented_native_frames_and_utf8_lines(self):
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, write_fd)
        stream = os.fdopen(read_fd, 'rb', buffering=0)
        self.addCleanup(stream.close)
        stopped = threading.Event()
        source = chat.StoppablePipeReader(stream, stopped)
        raw = json.dumps({'action': 'chat', 'text': '网页查证'}, ensure_ascii=False).encode()
        packet = struct.pack('<I', len(raw)) + raw
        result = []
        worker = threading.Thread(target=lambda: result.append(chat.read_native(source)))
        worker.start()
        for byte in packet:
            os.write(write_fd, bytes([byte]))
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result, [json.loads(raw)])
        os.write(write_fd, '第一行\n第二行\n'.encode())
        self.assertEqual(source.readline(), '第一行\n'.encode())
        self.assertEqual(source.readline(), '第二行\n'.encode())

    def test_main_joins_input_reader_before_returning_with_browser_pipe_open(self):
        # Keep the browser's writer open through main() return. Also exercise a
        # partial second frame: a fix that just joins a blocking read hangs here.
        # The parent releases stdin after the child reports its threads, so a
        # regression fails safely instead of producing a macOS crash dialog.
        source = str(Path(chat.__file__).resolve().parent)
        (self.base / 'allowed-origins.json').write_text(json.dumps(['test-origin']))
        program = r'''
import json,os,sys,threading,time
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import codex_chat as chat
chat.__file__=str(Path(sys.argv[2])/'codex_chat.py')
mode=sys.argv[3]
sys.argv=['probe','test-origin']
def request(data,emit,cancel):
    if mode in ('cancel','eof'):
        if not cancel.wait(3): raise RuntimeError('cancel not delivered')
        emit({'type':'cancelled'});return
    time.sleep(.05)
    if mode=='error':raise ValueError('expected error')
    emit({'type':'done'})
chat.run_request=request
code=chat.main()
remaining=[t for t in threading.enumerate() if t is not threading.main_thread()]
os.write(2,(json.dumps({'code':code,'remaining':[t.name for t in remaining]})+'\n').encode())
for t in remaining:t.join(timeout=3)
'''
        for mode in ('completed', 'error', 'cancel', 'eof'):
            with self.subTest(mode=mode):
                child = subprocess.Popen([sys.executable, '-c', program, source, str(self.base), mode], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    raw = json.dumps({'action': 'chat'}).encode()
                    packet = struct.pack('<I', len(raw)) + raw
                    if mode == 'cancel':
                        raw = json.dumps({'action': 'cancel'}).encode()
                        packet += struct.pack('<I', len(raw)) + raw
                    elif mode != 'eof':
                        packet += struct.pack('<I', 100) + b'{'
                    child.stdin.write(packet); child.stdin.flush()
                    if mode == 'eof': child.stdin.close()
                    self.assertTrue(select.select([child.stderr], [], [], 5)[0], 'main did not return')
                    state = json.loads(child.stderr.readline())
                    if not child.stdin.closed: child.stdin.close()
                    self.assertEqual(child.wait(timeout=5), 0)
                    self.assertEqual(state, {'code': 0, 'remaining': []})
                    result = chat.read_native(child.stdout)
                    self.assertEqual(result['type'], {'completed': 'done', 'error': 'error', 'cancel': 'cancelled', 'eof': 'cancelled'}[mode])
                    self.assertEqual(child.stderr.read(), b'')
                finally:
                    if not child.stdin.closed: child.stdin.close()
                    if child.poll() is None: child.kill(); child.wait(timeout=3)
                    child.stdout.close(); child.stderr.close()

    def test_rpc_close_stops_and_joins_a_reader_waiting_for_a_partial_line(self):
        fake = self.base / 'fake-codex'
        fake.write_text('#!' + sys.executable + '\n' + '''import json,sys,time
if '--version' in sys.argv:
 print('codex-cli 0.162.1')
else:
 for line in sys.stdin:
  request=json.loads(line)
  print(json.dumps({'id':request['id'],'result':{'ok':True}}),flush=True)
  sys.stdout.write('{');sys.stdout.flush()
  time.sleep(30)
''')
        fake.chmod(0o700)
        with patch.object(chat, 'find_codex', return_value=str(fake)):
            rpc = chat.Rpc(str(self.base), {}, threading.Event())
            try:
                self.assertEqual(rpc.request('probe', {}), {'ok': True})
            finally:
                rpc.close()
            self.assertFalse(rpc.reader.is_alive())
            self.assertIsNotNone(rpc.child.poll())
            self.assertTrue(rpc.child.stdin.closed and rpc.child.stdout.closed)


if __name__ == '__main__': unittest.main()
