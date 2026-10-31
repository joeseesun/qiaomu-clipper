import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import codex_images as images

PNG = b'\x89PNG\r\n\x1a\n' + b'fixture'


class CodexImagesTest(unittest.TestCase):
    def test_inline_image_and_scoped_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'image.png').write_bytes(PNG)
            self.assertEqual(images.image_bytes({'savedPath': str(root / 'image.png')}, root), (PNG, 'image/png'))
            self.assertEqual(images.image_bytes({'result': base64.b64encode(PNG).decode()}, root), (PNG, 'image/png'))
            with self.assertRaisesRegex(ValueError, 'path-invalid'):
                images.image_bytes({'savedPath': '/etc/passwd'}, root)
            with self.assertRaisesRegex(ValueError, 'invalid-image'):
                images.image_bytes({'result': base64.b64encode(b'html').decode()}, root)

    def test_inline_result_does_not_read_codex_global_artifact_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = {'result': base64.b64encode(PNG).decode(),
                    'savedPath': '/outside/generated_images/thread/call.png'}
            with patch.object(Path, 'read_bytes', side_effect=AssertionError('must use inline image')):
                self.assertEqual(images.image_bytes(item, root), (PNG, 'image/png'))
            with self.assertRaisesRegex(ValueError, 'path-invalid'):
                images.image_bytes({'result': '', 'savedPath': item['savedPath']}, root)

    def test_native_chunks_and_no_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = images.job_dir(root, 'fixture-id')
            folder.mkdir(parents=True)
            data = PNG + bytes(images.CHUNK)
            (folder / 'image').write_bytes(data)
            images.write_json(folder / 'job.json', {'state': 'ready', 'size': len(data), 'type': 'image/png'})
            first = images.handle({'action': 'codexImageRead', 'id': 'fixture-id', 'offset': 0}, root)
            self.assertLess(len(json.dumps(first).encode()), 1024 * 1024)
            second = images.handle({'action': 'codexImageRead', 'id': 'fixture-id', 'offset': first['next']}, root)
            self.assertEqual(base64.b64decode(first['data']) + base64.b64decode(second['data']), data)
            with patch.object(images, 'find_codex', return_value='/mock/codex'), patch.object(images.subprocess, 'Popen') as spawn:
                images.handle({'action': 'codexImageStart', 'id': 'fixture-id', 'prompt': 'Cat'}, root)
                spawn.assert_not_called()
            with self.assertRaises(ValueError):
                images.handle({'action': 'codexImageRead', 'id': '../outside', 'offset': 0}, root)

    def test_active_generation_prevents_uninstall(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = images.job_dir(root, 'active-job')
            folder.mkdir(parents=True)
            images.write_json(folder / 'job.json', {'state': 'running', 'created': images.time.time()})
            self.assertTrue(images.active_job(root))
            images.write_json(folder / 'job.json', {'state': 'ready', 'created': images.time.time()})
            self.assertFalse(images.active_job(root))

    def test_agent_image_event_becomes_a_durable_result(self):
        class FakeRpc:
            def __init__(self, cwd):
                self.notes = [
                    {'method': 'item/completed', 'params': {'threadId': 't', 'item': {'type': 'imageGeneration', 'result': base64.b64encode(PNG).decode()}}},
                    {'method': 'turn/completed', 'params': {'threadId': 't', 'turn': {'status': 'completed'}}},
                ]
            def initialize(self):
                pass
            def request(self, method, params):
                if method == 'account/read':
                    return {'account': {'type': 'chatgpt'}}
                if method == 'thread/start':
                    assert params['approvalPolicy'] == 'never' and params['ephemeral']
                    return {'thread': {'id': 't'}}
                assert params['sandboxPolicy']['networkAccess'] is False
                return {'turn': {'id': 'u'}}
            def close(self):
                pass
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            images.write_json(folder / 'job.json', {'prompt': 'Cat', 'model': '', 'created': 1})
            with patch.object(images, 'Rpc', FakeRpc):
                images.run(folder)
            meta = json.loads((folder / 'job.json').read_text())
            self.assertEqual(meta['state'], 'ready')
            self.assertNotIn('prompt', meta)
            self.assertEqual((folder / 'image').read_bytes(), PNG)
            self.assertFalse((folder / 'work').exists())


if __name__ == '__main__':
    unittest.main()
