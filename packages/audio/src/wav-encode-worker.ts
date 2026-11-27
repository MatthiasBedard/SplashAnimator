import {encodePcm16Wav,type WavEncodeOptions} from './wav-encode';
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
scope.onmessage=event=>{
 scope.onmessage=null;
 try{
  const {channels,sampleRate,options,clampDecoded}=event.data as {channels:Float32Array[];sampleRate:number;options:WavEncodeOptions;clampDecoded?:boolean};
  if(clampDecoded===true)for(const channel of channels)for(let i=0;i<channel.length;i++){
   const sample=channel[i];if(Number.isFinite(sample))channel[i]=Math.max(-1,Math.min(1,sample));
  }
  const bytes=encodePcm16Wav(channels,sampleRate,options);scope.postMessage({ok:true,bytes},[bytes.buffer]);
 }
 catch(error){scope.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
