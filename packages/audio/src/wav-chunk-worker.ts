import {createWavChunkProcessor} from './wav-chunk-processor';
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
const processor=createWavChunkProcessor();
scope.onmessage=event=>{
 try{
  const response=processor.process(event.data);
  if(response.type==='done')scope.onmessage=null;
  scope.postMessage(response,response.type==='chunk'?[response.bytes.buffer]:[]);
 }catch(error){scope.onmessage=null;processor.dispose();scope.postMessage({type:'error',error:String(error).slice(0,2000)});}
};
