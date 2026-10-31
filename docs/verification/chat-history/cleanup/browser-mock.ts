// Test data only. Never reads or writes chrome.storage.
export const values: Record<string, any> = {};
export default {
 storage: { local: {
  get: async (keys: string | string[] | null) => structuredClone(keys === null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in values).map(k => [k, values[k]]))),
  set: async (next: object) => Object.assign(values, next),
  remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
 } }
};
