// Screenshot fixture only. No credentials, native calls or external model requests.
import messages from '../../../../src/_locales/zh_CN/messages.json';
const listeners = { addListener() {}, removeListener() {}, hasListener() { return false; } };
const provider = { id: 'demo', name: '我的 AI', baseUrl: 'https://example.invalid/v1', apiKey: '', apiKeyRequired: false };
const data: Record<string, any> = {
  language: 'zh_CN', migrationVersion: 99,
  interpreter_settings: {
    interpreterEnabled: true, interpreterAutoRun: false, interpreterModel: 'demo-flash',
    models: [{ id: 'demo-flash', name: 'DeepSeek Flash', modelId: 'deepseek-flash', providerId: 'demo', enabled: true }],
    providers: [provider], defaultPromptContext: '',
  },
  general_settings: { readerAutoChat: false, learningNotes: true },
  reader_settings: { fontSize: 19, lineHeight: 1.8, maxWidth: 38, appearance: 'light', lightTheme: 'default' },
  qiaomuWebSearch: { enabled: true, provider: 'deepseek', keys: {} },
};
const area = {
  async get(keys: any) { return keys == null ? {...data} : Object.fromEntries((typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)).map((k: string) => [k, data[k]])); },
  async set(value: any) { Object.assign(data, value); },
  async remove(keys: any) { for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k]; },
  async getBytesInUse() { return 0; },
};
const browser = {
  storage: { local: area, sync: area, session: area, onChanged: listeners },
  runtime: {
    id: 'qiaomu-store-screenshot-demo',
    getURL: (path: string) => new URL('/' + path, location.origin).href,
    getManifest: () => ({ version: '1.19.0', name: '乔木剪藏 · Obsidian + RSS' }),
    onMessage: listeners, onConnect: listeners,
    async sendMessage(message: any) {
      if (message?.action === 'chatToolsCapabilities') return { ok: true, web: true, webEnabled: true, webProvider: 'DeepSeek', images: true, fetch: true };
      if (message?.action === 'imageJobEnsure') return { ok: true };
      return { ok: false, error: '截图示例不调用外部服务' };
    },
    connect: () => ({ onMessage: listeners, onDisconnect: listeners, postMessage() {}, disconnect() {} }),
  },
  i18n: {
    getUILanguage: () => 'zh-CN',
    getMessage: (key: string, args: any) => {
      let s = (messages as any)[key]?.message || key;
      const placeholders = (messages as any)[key]?.placeholders || {};
      const values = Array.isArray(args) ? args : [args];
      for (const [name, p] of Object.entries(placeholders) as any) s = s.replace(new RegExp('\\$' + name + '\\$', 'gi'), values[Number(p.content?.slice(1)) - 1] || '');
      return s;
    },
  },
  tabs: { async create() {}, async query() { return []; }, async sendMessage() { return {}; }, onUpdated: listeners, onActivated: listeners },
  windows: { async getCurrent() { return { id: 1 }; } },
  permissions: { async contains() { return false; } },
};
export default browser as any;
