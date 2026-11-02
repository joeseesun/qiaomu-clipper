import browser from './browser-polyfill';
export async function openAiSidebar(target: { tabId: number } | number): Promise<void> {
 if (typeof chrome === 'undefined' || !chrome.sidePanel) throw new Error('Side panel is unavailable in this browser.');
 // Keep the old numeric windowId contract for callers from other feature
 // branches. New callers pass an explicit tabId and retain the click gesture.
 if (typeof target === 'number') {
  if (!Number.isInteger(target) || target < 0) throw new Error('A source window is required.');
  const [tab] = await browser.tabs.query({ active: true, windowId: target });
  if (tab?.id === undefined) throw new Error('A source tab is required.');
  return openAiSidebar({ tabId: tab.id });
 }
 const { tabId } = target;
 if (!Number.isInteger(tabId) || tabId < 0) throw new Error('A source tab is required.');
 // Start both calls inside the click handler: awaiting setOptions first loses
 // Chrome's transient user gesture in a service-worker context-menu callback.
 // Both options and open must be tab-scoped. open({ tabId }) alone falls back
 // to the global panel when the tab has no specific configuration.
 const configured = chrome.sidePanel.setOptions({ tabId, path: `ai-side-panel.html?tab=${tabId}`, enabled: true });
 const opened = chrome.sidePanel.open({ tabId });
 await Promise.all([configured, opened]);
}
export async function openCurrentAiSidebar(): Promise<void> {
 const [current] = await browser.tabs.query({ active: true, currentWindow: true });
 if (current?.id !== undefined) await openAiSidebar({ tabId: current.id });
}

// Chrome otherwise falls back to the manifest's global clipper panel when
// leaving a tab-specific AI panel. Both UI entries now opt in per tab, so
// disable the default (including a legacy global AI setting) on worker start.
export async function disableGlobalSidebar(): Promise<void> {
 if (typeof chrome === 'undefined' || !chrome.sidePanel) return;
 await chrome.sidePanel.setOptions({ path: 'side-panel.html', enabled: false });
}
