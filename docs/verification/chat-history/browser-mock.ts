// Public fixture only: no extension account, settings, model or website access.
export default {
 storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {}, removeListener() {} } },
 runtime: { getURL: (path: string) => path, sendMessage: async () => ({}), onMessage: { addListener() {}, removeListener() {} } },
 i18n: { getMessage: (key: string) => ({ qiaomuChatTitle: 'AI 对话', qiaomuChatHistory: '历史对话', qiaomuChatNew: '新对话', close: '关闭', qiaomuChatPreferences: '对话设置', qiaomuChatNoModel: '查看历史无需配置模型', qiaomuChatOpenSettings: '配置模型', qiaomuActionCopy: '复制' }[key] || key) },
 tabs: { query: async () => [] }
};
