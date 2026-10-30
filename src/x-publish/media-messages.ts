import { t } from '../utils/ui-text';

// Both the writer window and X's progress card use the same stage wording.
export function describeXMediaMessage(text: string): string {

 const recoveryMessages: Record<string,string> = {
  'This draft has no matching upload checkpoint. Check the draft before starting again.': t('没有找到对应的续传记录，请先检查 X 草稿。'),
  'The draft was edited after stopping. Resume was stopped to preserve your changes.': t('草稿在停止后被修改，为保留你的改动，已停止续传。'),
  'An uploaded media item was removed or changed. Check the draft before resuming.': t('已上传的媒体被删除或修改，请先检查 X 草稿。'),
  'The current media status is uncertain. Check X before resuming to avoid duplicates.': t('当前媒体状态尚未确认，请先检查 X，避免重复上传。'),
  'X is still processing the current media. Wait for it to finish before resuming.': t('X 仍在处理当前媒体，请稍后继续。'),
  'The draft media changed after stopping. Check it before resuming.': t('草稿中的媒体在停止后发生变化，请先检查再继续。'),
  'The X draft changed during upload. Writing stopped.': t('草稿在停止后被修改，为保留你的改动，已停止续传。'),
 };
 if (recoveryMessages[text]) return recoveryMessages[text];
 const upload = text.match(/^Uploading media (\d+)\/(\d+)(.*)$/i);
 if (upload) {
  const processing = /X is processing/i.test(upload[3]);
  const message = processing ? t('X 正在处理媒体 {0}/{1}…', [upload[1], upload[2]]) : t('正在上传媒体 {0}/{1}…', [upload[1], upload[2]]);
  return message + (upload[3].match(/\([\d.]+%\)/)?.[0] || '');
 }
 let message = text.replace('X did not confirm media completion. The media may already be in the draft; check it before writing again.', t('X 尚未确认媒体处理完成。媒体可能已在草稿中，请先检查草稿，避免重复写入。'));
 message = message.replace(/^Media (\d+)\/(\d+): /, (_all, index, total) => t('媒体 {0}/{1}：', [index, total]));
 return message;
}
