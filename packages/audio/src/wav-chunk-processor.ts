import {createPcm16WavChunks,type WavChunkOptions} from './wav-encode';
/** One request/acknowledgement at a time. A malformed request permanently closes the
 * processor; callers discard provisional bytes. The host acknowledges only after its
 * async sink finishes, so the processor never queues PCM chunks itself. */
export function createWavChunkProcessor(){
 let chunks:ReturnType<typeof createPcm16WavChunks>|undefined,sequence=0,terminal=false;
 const dispose=()=>{terminal=true;chunks?.return();chunks=undefined;};
 const process=(message:unknown)=>{
  try{
   if(terminal)throw new Error('WAV chunk processor is closed.');
   if(!message||typeof message!=='object'||Array.isArray(message))throw new Error('Invalid WAV chunk request.');
   const request=message as Record<string,unknown>;
   if(!chunks){
    if(request.type!=='start'||Object.keys(request).some(k=>!['type','channels','sampleRate','options'].includes(k)))throw new Error('Expected WAV chunk start.');
    if(request.options!==undefined&&(!request.options||typeof request.options!=='object'||Array.isArray(request.options)||Object.keys(request.options).some(k=>!['chunkFrames','maxBytes'].includes(k))))throw new Error('Invalid WAV chunk options.');
    chunks=createPcm16WavChunks(request.channels as Float32Array[],request.sampleRate as number,request.options as WavChunkOptions|undefined);
   }else if(request.type!=='ack'||Object.keys(request).length!==2||request.sequence!==sequence-1)throw new Error('Invalid WAV chunk acknowledgement.');
   const next=chunks.next();
   if(next.done){const receipt=next.value;dispose();return {type:'done' as const,sequence,receipt};}
   return {type:'chunk' as const,sequence:sequence++,bytes:next.value};
  }catch(error){dispose();throw error;}
 };
 return {process,dispose};
}
