// The interface is written in Chinese; tests read it as a Simplified Chinese reader would (UI_LANG=en runs them as an English reader).
Object.defineProperty(navigator, 'language', { value: process.env.UI_LANG === 'en' ? 'en-US' : 'zh-CN', configurable: true });
