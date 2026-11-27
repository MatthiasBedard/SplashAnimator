import {createGifStreamProcessor} from './gif-stream';
// Trusted raster codec only. Host owns timeout/cancellation and serial request backpressure.
const processRequest=createGifStreamProcessor();
self.onmessage=event=>{
  try{
    const result=processRequest(event.data);
    if(result.bytes){self.onmessage=null;self.postMessage({ok:true,...result},{transfer:[result.bytes.buffer]});}
    else self.postMessage({ok:true,...result});
  }catch(error){self.onmessage=null;self.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
