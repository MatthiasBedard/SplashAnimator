/** Locked writable destination for provisional media bytes. Commit only with a successful
 * encoder receipt. close() is the publication boundary and cannot be cancelled once begun.
 * File rollback requires a transactional writable such as createWritable(); generic streams
 * may already have external side effects and cannot promise rollback.
 */
export function createMediaWritableDestination(stream:WritableStream<Uint8Array>,maxBytes=512*1024*1024){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>512*1024*1024)throw new Error('Invalid Media destination budget.');
  const writer=stream.getWriter();
  let state:'open'|'aborting'|'closing'|'closed'|'failed'='open',busy=false,written=0,released=false;
  let aborting:Promise<void>|undefined;
  const release=()=>{if(!released){writer.releaseLock();released=true;}};
  const abort=(reason:unknown)=>{
    if(aborting)return aborting;
    if(state==='closed')return Promise.resolve();
    if(state==='closing')return Promise.reject(new Error('Media destination commit has already begun.'));
    state='aborting';
    aborting=writer.abort(reason).then(()=>{state='closed';},error=>{state='failed';throw error;}).finally(release);
    return aborting;
  };
  const write=async(chunk:Uint8Array,signal:AbortSignal)=>{
    if(state!=='open'||busy)throw new Error('Media destination is closed or busy.');
    if(!(chunk instanceof Uint8Array)||chunk.length<1||written+chunk.length>maxBytes)throw new Error('Invalid or oversized Media destination chunk.');
    signal.throwIfAborted();busy=true;
    const cancelled=()=>{void abort(signal.reason).catch(()=>{});};
    signal.addEventListener('abort',cancelled,{once:true});
    try{
      if(signal.aborted){await abort(signal.reason);signal.throwIfAborted();}
      await writer.write(chunk);
      signal.throwIfAborted();
      if(state!=='open')throw new Error('Media destination was aborted.');
      written+=chunk.length;
    }catch(error){
      try{await abort(error);}catch(cleanup){throw new AggregateError([error,cleanup],'Media write and destination abort failed.');}
      throw error;
    }finally{busy=false;signal.removeEventListener('abort',cancelled);}
  };
  const commit=async(receipt:{bytesWritten:number},signal:AbortSignal)=>{
    if(state!=='open'||busy)throw new Error('Media destination is closed or busy.');
    if(!Number.isSafeInteger(receipt.bytesWritten)||receipt.bytesWritten<1||receipt.bytesWritten!==written)
      throw new Error('Media destination receipt does not match written bytes.');
    signal.throwIfAborted();state='closing';
    try{await writer.close();state='closed';}
    catch(error){state='failed';try{await abort(error);}catch(cleanup){throw new AggregateError([error,cleanup],'Media commit and abort failed.');}throw error;}
    finally{release();}
  };
  return {write,abort,commit};
}
