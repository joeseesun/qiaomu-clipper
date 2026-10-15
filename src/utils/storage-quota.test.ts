import { expect, it, vi } from 'vitest';
import { isStorageQuotaError, setWithQuotaRecovery } from './storage-quota';

it('retries a draft write after removing only refetchable captions, including legacy entries', async () => {
 const data:Record<string,unknown>={
  'qiaomuTranscript2:abcdefghijk': {segments:['old']},
  'qiaomuTranscript3:abcdefghijk#original': {segments:['official']},
  'qiaomuTranscript2:generated:youtube:abcdefghijk': {segments:['paid words']},
  'qiaomuPreview:edited': {studyEditedAt:1,clip:{markdown:'my notes'}},
  'qiaomuPreview:unmodified': {clip:{markdown:'keep this too'}},
  settings:{token:'private'},
 };
 const set=vi.fn().mockRejectedValueOnce(new Error('Resource::kQuotaBytes quota exceeded')).mockImplementation(async items=>Object.assign(data,items));
 const remove=vi.fn(async keys=>{for(const key of keys) delete data[key];});
 const draft={'qiaomuPreview:current':{clip:{markdown:'new subtitle'}}};
 await setWithQuotaRecovery({get:async()=>data,set,remove},draft);
 expect(set).toHaveBeenCalledTimes(2);
 expect(remove).toHaveBeenCalledWith(['qiaomuTranscript2:abcdefghijk']);
 expect(data['qiaomuTranscript3:abcdefghijk#original']).toBeDefined();
 expect(data['qiaomuTranscript2:generated:youtube:abcdefghijk']).toEqual({segments:['paid words']});
 expect(data['qiaomuPreview:edited']).toBeDefined();expect(data['qiaomuPreview:unmodified']).toBeDefined();expect(data.settings).toBeDefined();
 expect(data['qiaomuPreview:current']).toEqual(draft['qiaomuPreview:current']);
});

it('does not clear data for other errors and does not retry endlessly', async () => {
 const get=vi.fn(async()=>({})),remove=vi.fn();
 const store={get,remove,set:vi.fn().mockRejectedValue(new Error('offline'))};
 await expect(setWithQuotaRecovery(store,{})).rejects.toThrow('offline');expect(get).not.toHaveBeenCalled();
 store.set.mockRejectedValue(new Error('Resource::kQuotaBytes quota exceeded'));
 await expect(setWithQuotaRecovery(store,{})).rejects.toThrow('quota exceeded');expect(remove).not.toHaveBeenCalled();
 expect(isStorageQuotaError(new Error('provider quota exceeded'))).toBe(false);
});


it('reclaims the oldest captions first and stops as soon as the new draft fits', async () => {
 const data:Record<string,unknown>={
  'qiaomuTranscript3:aaaaaaaaaaa':{at:30},
  'qiaomuTranscript3:bbbbbbbbbbb':{at:10},
  'qiaomuTranscript3:ccccccccccc':{at:20},
 };
 const remove=vi.fn(async(keys:string[])=>{for(const key of keys) delete data[key];});
 const set=vi.fn(async(items:Record<string,unknown>)=>{
  if(Object.keys(data).length>1) throw new Error('Resource::kQuotaBytes quota exceeded');
  Object.assign(data,items);
 });
 await setWithQuotaRecovery({get:async()=>data,set,remove},{draft:'new'});
 expect(remove.mock.calls).toEqual([[['qiaomuTranscript3:bbbbbbbbbbb']],[['qiaomuTranscript3:ccccccccccc']]]);
 expect(data).toEqual({'qiaomuTranscript3:aaaaaaaaaaa':{at:30},draft:'new'});
});
