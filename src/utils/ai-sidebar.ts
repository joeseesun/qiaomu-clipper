import browser from './browser-polyfill';
export async function openAiSidebar(windowId: number): Promise<void> {
 if (typeof chrome === 'undefined' || !chrome.sidePanel) throw new Error('Side panel is unavailable in this browser.');
 // Start both calls inside the click handler: awaiting setOptions first loses
 // Chrome's transient user gesture in a service-worker context-menu callback.
 const configured = chrome.sidePanel.setOptions({ path: 'ai-side-panel.html', enabled: true });
 const opened = chrome.sidePanel.open({ windowId });
 await Promise.all([configured, opened]);
}
export async function openCurrentAiSidebar(): Promise<void> {
 const current = await browser.windows.getCurrent();
 if (current.id !== undefined) await openAiSidebar(current.id);
}
