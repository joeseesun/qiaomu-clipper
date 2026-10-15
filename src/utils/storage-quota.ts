// Match the browser's quota error, not network or model-provider limits.
export function isStorageQuotaError(error: unknown): boolean {
 const message = error instanceof Error ? error.message : String(error);
 return /kQuotaBytes|QUOTA_BYTES|QuotaExceededError|storage quota.*exceeded/i.test(message)
  || (error instanceof Error && error.name === 'QuotaExceededError');
}

interface LocalStore {
 get(keys: null): Promise<Record<string, unknown>>;
 set(items: Record<string, unknown>): Promise<void>;
 remove(keys: string[]): Promise<void>;
}
// Only platform transcripts are reproducible. Keep all drafts, settings and generated captions.
export async function setWithQuotaRecovery(store: LocalStore, items: Record<string, unknown>): Promise<void> {
 try { await store.set(items); return; }
 catch (error) {
  if (!isStorageQuotaError(error)) throw error;
  const saved = await store.get(null);
  const expendable = Object.keys(saved).filter(key =>
   /^qiaomuTranscript[23]:(?:[\w-]{11}|bilibili:BV[0-9A-Za-z]{10}:\d{1,4})(?:#[a-z]{2,8})?$/.test(key)
   && !Object.prototype.hasOwnProperty.call(items, key));
  expendable.sort((a, b) => {
   const timestamp = (key: string) => {
    const at = (saved[key] as {at?:number} | null)?.at;
    return typeof at === 'number' && Number.isFinite(at) ? at : 0;
   };
   return timestamp(a) - timestamp(b);
  });
  let failure = error;
  for (const key of expendable) {
   await store.remove([key]);
   try { await store.set(items); return; }
   catch (next) { if (!isStorageQuotaError(next)) throw next; failure = next; }
  }
  throw failure;
 }
}
