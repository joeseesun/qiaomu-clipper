export function stopped(signal?: AbortSignal): void {
 if (signal?.aborted) throw Object.assign(new Error('stopped'), { stopped: true });
}
export function whileActive<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
 return new Promise((resolve,reject)=>{
  const abort=()=>{cleanup();reject(Object.assign(new Error('stopped'),{stopped:true}));};
  const cleanup=()=>signal.removeEventListener('abort',abort);
  if(signal.aborted){void work.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  work.then(value=>{cleanup();if(signal.aborted)abort();else resolve(value);},error=>{cleanup();reject(error);});
 });
}
