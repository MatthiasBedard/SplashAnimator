import {decodePcm16Wav,type WavDecodeOptions} from './wav';
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
scope.onmessage=event=>{
  scope.onmessage=null;
  try{const {bytes,options}=event.data as {bytes:Uint8Array;options:WavDecodeOptions};
    const result=decodePcm16Wav(bytes,options);scope.postMessage({ok:true,result},result.channels.map(c=>c.buffer as ArrayBuffer));
  }catch(error){scope.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
