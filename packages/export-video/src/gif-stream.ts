import {createGifPaletteAnalyzer,gifFrameDelays,type RgbaGifInput} from './gif-rgba';
import {createIndexedGifEncoder,createIndexedGifChunkEncoder} from './gif';
export interface GifStreamSettings extends Omit<RgbaGifInput,'frames'> {frameCount:number}
export type GifStreamRequest =
  | {seq:number;kind:'init';settings:GifStreamSettings;maxBytes:number;maxIndexedBytes:number}
  | {seq:number;kind:'analyze'|'index';frame:Uint8Array|Uint8ClampedArray}
  | {seq:number;kind:'seal'|'finish'};
/** Trusted worker protocol. Strict sequence/phase ordering, terminal failure, no partial output.
 * Host must await each acknowledgment before sending another frame. This synchronous core
 * cannot bound a browser's incoming message queue; host backpressure remains mandatory.
 */
export function createGifStreamProcessor(writeChunk?: (chunk:Uint8Array)=>void){
  let sequence=0,phase:'init'|'analyze'|'index'|'done'|'failed'='init',accepted=0;
  let settings:GifStreamSettings|undefined,maxBytes=0;
  let analyzer:ReturnType<typeof createGifPaletteAnalyzer>|undefined;
  let palette:ReturnType<ReturnType<typeof createGifPaletteAnalyzer>['finish']>|undefined;
  let encoder:ReturnType<typeof createIndexedGifEncoder>|ReturnType<typeof createIndexedGifChunkEncoder>|undefined,scratch:Uint8Array|undefined;
  const release=()=>{settings=undefined;analyzer=undefined;palette=undefined;encoder=undefined;scratch=undefined;};
  return (request:GifStreamRequest)=>{
    try{
      if(phase==='done'||phase==='failed')throw new Error('GIF stream is closed.');
      if(!request||!Number.isSafeInteger(request.seq)||request.seq!==sequence)throw new Error('Invalid GIF stream sequence.');
      if(request.kind==='init'&&phase==='init'){
        for(const budget of [request.maxBytes,request.maxIndexedBytes])
          if(!Number.isSafeInteger(budget)||budget<1||budget>512*1024*1024)throw new Error('Invalid GIF stream budget.');
        settings=structuredClone(request.settings);maxBytes=request.maxBytes;
        if(settings.loop!==undefined&&typeof settings.loop!=='boolean')throw new Error('Invalid GIF loop option.');
        if(settings.compression!==undefined&&settings.compression!=='literal'&&settings.compression!=='dictionary')throw new Error('Invalid GIF compression option.');
        analyzer=createGifPaletteAnalyzer(settings,settings.frameCount,request.maxIndexedBytes);
        const start=settings.startFrame??0;
        gifFrameDelays(1,settings.fps,start);
        gifFrameDelays(1,settings.fps,start+settings.frameCount-1);
        phase='analyze';
      }else if(request.kind==='analyze'&&phase==='analyze'){
        analyzer!.append(request.frame);accepted++;
      }else if(request.kind==='seal'&&phase==='analyze'){
        palette=analyzer!.finish();analyzer=undefined;
        const config={width:settings!.width,height:settings!.height,palette:palette.palette,
          frameCount:settings!.frameCount,loop:settings!.loop,compression:settings!.compression,...(settings!.transparent?{transparentIndex:0}:{})};
        encoder=writeChunk?createIndexedGifChunkEncoder(config,writeChunk,maxBytes):createIndexedGifEncoder(config,maxBytes);
        scratch=new Uint8Array(settings!.width*settings!.height);accepted=0;phase='index';
      }else if(request.kind==='index'&&phase==='index'){
        if(accepted>=settings!.frameCount)throw new Error('GIF stream has no remaining frames.');
        const delay=gifFrameDelays(1,settings!.fps,(settings!.startFrame??0)+accepted)[0];
        encoder!.append({pixels:palette!.index(request.frame,scratch),delayCentiseconds:delay});accepted++;
      }else if(request.kind==='finish'&&phase==='index'){
        const bytes=encoder!.finish(),quantized=palette!.quantized;phase='done';release();sequence++;
        return {seq:request.seq,phase,accepted,bytes,quantized};
      }else throw new Error('Invalid GIF stream phase.');
      sequence++;
      return {seq:request.seq,phase,accepted};
    }catch(error){phase='failed';release();throw error;}
  };
}
