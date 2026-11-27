import {encodeRgbaGif} from './gif-rgba';
// Trusted codec only: no document source evaluation or external resource loading.
self.onmessage=event=>{
  self.onmessage=null;
  try{
    const {bytes,quantized}=encodeRgbaGif(event.data.input,event.data.maxBytes,event.data.maxIndexedBytes);
    self.postMessage({ok:true,bytes,quantized},{transfer:[bytes.buffer]});
  }catch(error){self.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
