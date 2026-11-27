import {createGifStreamProcessor,type GifStreamRequest} from './gif-stream';
export type GifChunkRequest=GifStreamRequest|{kind:'ack-chunk';seq:number;chunkId:number};
export type GifChunkResponse=
  | {kind:'chunk';seq:number;chunkId:number;bytes:Uint8Array}
  | {kind:'ack';seq:number;phase:string;accepted:number;quantized?:boolean};
/** One transferred chunk awaits acknowledgment; frame-level synchronous encoding may queue
 * up to maxPendingBytes before delivery. This is bounded per-request buffering, not a
 * preemptible per-byte encoder. Recipients must discard provisional output on any failure.
 */
export function createGifChunkStreamProcessor(maxPendingBytes=16*1024*1024){
  if(!Number.isSafeInteger(maxPendingBytes)||maxPendingBytes<65536||maxPendingBytes>512*1024*1024)
    throw new Error('Invalid GIF pending chunk budget.');
  let queue:Uint8Array[]=[],queuedBytes=0,chunkId=0,waiting=false,closed=false;
  let completion:GifChunkResponse&{kind:'ack'}|undefined;
  let process:ReturnType<typeof createGifStreamProcessor>|undefined=createGifStreamProcessor(chunk=>{
    if(queuedBytes+chunk.byteLength>maxPendingBytes)throw new Error('GIF pending chunks exceed the byte budget.');
    queuedBytes+=chunk.byteLength;queue.push(chunk);
  });
  const next=():GifChunkResponse=>{
    if(queue.length){
      const bytes=queue.shift()!;queuedBytes-=bytes.byteLength;waiting=true;
      return {kind:'chunk',seq:completion!.seq,chunkId:chunkId++,bytes};
    }
    const result=completion!;completion=undefined;waiting=false;
    if(result.phase==='done'){closed=true;process=undefined;}
    return result;
  };
  return (request:GifChunkRequest):GifChunkResponse=>{
    try{
      if(closed)throw new Error('GIF chunk stream is closed.');
      if(waiting){
        if(request.kind!=='ack-chunk'||request.seq!==completion!.seq||request.chunkId!==chunkId-1)
          throw new Error('GIF chunk acknowledgment required.');
        return next();
      }
      if(request.kind==='ack-chunk')throw new Error('Unexpected GIF chunk acknowledgment.');
      const result=process!(request);
      completion={kind:'ack',seq:result.seq,phase:result.phase,accepted:result.accepted,...(result.quantized===undefined?{}:{quantized:result.quantized})};
      return next();
    }catch(error){closed=true;queue=[];queuedBytes=0;completion=undefined;process=undefined;throw error;}
  };
}
