#!/usr/bin/env python3
"""Install the separate web-chat host without replacing the existing helper."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys


def install(extension_id, browser_user_data=None):
    if sys.platform != 'darwin':
        raise SystemExit('This installer targets macOS Chrome/SunBrowser only.')
    if not re.fullmatch('[a-p]{32}', extension_id):
        raise SystemExit('Invalid extension ID')
    source = Path(__file__).resolve().parent
    target = Path.home() / '.local/share/qiaomu-clipper-codex-chat/host'
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ('codex_chat.py', 'codex_chat_policy.py'):
        shutil.copy2(source / name, target / name)
    script = target / 'codex_chat.py'
    script.write_text('#!' + sys.executable + '\n' + script.read_text().split('\n', 1)[1])
    os.chmod(script, 0o700)
    origins = ['chrome-extension://' + extension_id + '/']
    (target / 'allowed-origins.json').write_text(json.dumps(origins))
    proxy_keys = ('http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'no_proxy', 'NO_PROXY')
    network = {key: os.environ[key] for key in proxy_keys if os.environ.get(key)}
    if any(key.lower() != 'no_proxy' for key in network):
        network_path = target / 'network.json'
        network_path.write_text(json.dumps(network))
        os.chmod(network_path, 0o600)
    manifest = {'name': 'ai.qiaomu.clipper.codex_chat', 'description': 'Qiaomu native Codex web chat',
                'path': str(script), 'type': 'stdio', 'allowed_origins': origins}
    registrations = []
    # Chromium's DIR_USER_NATIVE_MESSAGING is DIR_USER_DATA/NativeMessagingHosts.
    # AdsPower passes its own --user-data-dir for each isolated environment.
    directories = [Path(browser_user_data).resolve()] if browser_user_data else [Path.home() / 'Library/Application Support/Google/Chrome']
    for directory in directories:
        if not directory.is_dir():
            raise SystemExit('Browser user-data directory does not exist')
        registration = directory / 'NativeMessagingHosts/ai.qiaomu.clipper.codex_chat.json'
        registration.parent.mkdir(parents=True, exist_ok=True)
        registration.write_text(json.dumps(manifest, indent=2))
        os.chmod(registration, 0o600)
        registrations.append(str(registration))
    print(json.dumps({'host': str(script), 'registrations': registrations, 'extensionId': extension_id}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--extension-id', required=True)
    parser.add_argument('--browser-user-data')
    args = parser.parse_args()
    install(args.extension_id, args.browser_user_data)
