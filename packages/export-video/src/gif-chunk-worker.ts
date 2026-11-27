import {createGifChunkStreamProcessor} from './gif-chunk-stream';
const processRequest=createGifChunkStreamProcessor();
self.onmessage=event=>{
  try{
    const result=processRequest(event.data);
    if(result.kind==='chunk')self.postMessage({ok:true,...result},{transfer:[result.bytes.buffer]});
    else{if(result.phase==='done')self.onmessage=null;self.postMessage({ok:true,...result});}
  }catch(error){self.onmessage=null;self.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
