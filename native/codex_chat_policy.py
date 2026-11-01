"""Process-scoped Codex web-chat policy. Never edits the user's Codex config.

0.162.1 registers apply_patch/multi-agent from model metadata even when the
feature flags are off. A private catalog removes those host-tool capabilities;
model IDs, reasoning levels, context limits and wire protocol stay unchanged.
The offline registry test is required before admitting another CLI version.
"""
import json
import re
from pathlib import Path

VERIFIED_CLI = '0.162.1'
DISABLED = ('shell_tool', 'shell_snapshot', 'apps', 'plugins', 'memories', 'hooks',
            'computer_use', 'browser_use', 'browser_use_external', 'view_image',
            'image_generation', 'multi_agent', 'multi_agent_v2', 'workspace_dependencies',
            'chronicle', 'goals', 'sleep_tool', 'request_permissions_tool', 'tool_suggest',
            'skill_search', 'default_mode_request_user_input')


def restricted_catalog(data):
    result = json.loads(json.dumps(data))
    if not isinstance(result.get('models'), list) or not result['models']:
        raise ValueError('Codex 模型目录不可用，请先在本机 Codex 中刷新模型列表。')
    for model in result['models']:
        model['apply_patch_tool_type'] = None
        model['multi_agent_version'] = 'disabled'
        model['node_repl_disabled'] = True
        model['experimental_supported_tools'] = [x for x in model.get('experimental_supported_tools', []) if x == 'clock']
    return {'models': result['models']}


def policy(catalog_path, web, codex_dir=None):
    cfg = {**{'features.' + key: False for key in DISABLED},
           'features.skip_host_skill_discovery': True,
           'web_search': 'live' if web else 'disabled',
           'skills.bundled.enabled': False, 'skills.include_instructions': False,
           'tools.view_image': False, 'project_doc_max_bytes': 0,
           'model_catalog_json': str(catalog_path),
           'model_provider': 'openai', 'approval_policy': 'never', 'sandbox_mode': 'read-only'}
    # Disable all configured MCP servers, including quoted server names. Apps and
    # plugins are disabled separately above; this client exposes no connectors.
    config = (codex_dir or Path.home() / '.codex') / 'config.toml'
    if config.exists():
        for match in re.finditer(r'^\s*\[mcp_servers\.(?:"([^"\n]+)"|\'([^\'\n]+)\'|([A-Za-z0-9_-]+))(?=\.|\])', config.read_text(), re.M):
            name = next(x for x in match.groups() if x is not None)
            if not re.fullmatch(r'[A-Za-z0-9_-]+', name):
                raise ValueError('当前 MCP 配置名称需要更新对话助手后才能安全隔离。')
            cfg['mcp_servers.' + name + '.enabled'] = False
    return cfg
