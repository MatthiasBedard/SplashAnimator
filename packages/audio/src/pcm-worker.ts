import {mixTimelinePcm,type TimelinePcmClip,type TimelinePcmOptions} from './pcm';
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
scope.onmessage=event=>{
  scope.onmessage=null;
  try{const {clips,options}=event.data as {clips:TimelinePcmClip[];options:TimelinePcmOptions};
    const result=mixTimelinePcm(clips,options);scope.postMessage({ok:true,result},result.channels.map(c=>c.buffer as ArrayBuffer));
  }catch(error){scope.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
