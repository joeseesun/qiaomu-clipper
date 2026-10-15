import browser from './browser-polyfill';
import { DownloadError } from './media-download';
import { t } from './ui-text';

// Report success only after Chrome confirms the file is on disk, including an
// immediate completion that happened before downloads.download returned its ID.
export async function saveDownloadedBlob(blob: Blob, filename: string, signal?: AbortSignal): Promise<{ reveal: () => void }> {
 const url = URL.createObjectURL(blob);
 let id: number | undefined;
 try {
  if (signal?.aborted) throw new DownloadError('cancelled', t('已取消'));
  id = await browser.downloads.download({ url, filename: t('乔木剪藏/{0}', [filename]), saveAs: false, conflictAction: 'uniquify' });
  const downloadId = id;
  await new Promise<void>((resolve, reject) => {
   let settled = false;
   const finish = (error?: Error) => {
    if (settled) return; settled = true;
    clearTimeout(timer); browser.downloads.onChanged.removeListener(changed); signal?.removeEventListener('abort', cancelled);
    error ? reject(error) : resolve();
   };
   const state = (value?: string) => {
    if (value === 'complete') finish();
    else if (value === 'interrupted') finish(new DownloadError('network', t('下载中断')));
   };
   const changed = (delta: { id: number; state?: { current?: string } }) => { if (delta.id === downloadId) state(delta.state?.current); };
   const cancelled = () => { void browser.downloads.cancel(downloadId).catch(() => {}); finish(new DownloadError('cancelled', t('已取消'))); };
   const timer = setTimeout(() => { void browser.downloads.cancel(downloadId).catch(() => {}); finish(new DownloadError('network', t('下载中断'))); }, 300000);
   browser.downloads.onChanged.addListener(changed); signal?.addEventListener('abort', cancelled, { once: true });
   if (signal?.aborted) { cancelled(); return; }
   void browser.downloads.search({ id: downloadId }).then(items => { if (!items.length) finish(new DownloadError('network', t('下载中断'))); else state(items[0].state); }).catch(error => finish(error));
  });
  return { reveal: () => { void browser.downloads.show(downloadId); } };
 } finally { URL.revokeObjectURL(url); }
}
