import {expandSymbols} from '../../geometry/src/symbols';
import type {SymbolAuthoringSource} from './symbol-motion-owner';
import {prepareSymbolRememberedCapture} from './symbol-remembered-capture';
import {createSymbolPreviewClock} from './symbol-preview-clock';

/** A private, read-only playback session. Preparation admits every reachable child
 * before returning; neither prepared definitions nor clocks are authoring inputs. */
export async function prepareSymbolRememberedPlayback(
 readSource:()=>SymbolAuthoringSource,fps:number,first:number,last:number,
 options:{signal?:AbortSignal;validate?:()=>void}={},
){
 const capture=await prepareSymbolRememberedCapture(readSource,fps,(definition,symbols)=>{
  // Admit the playback range and original clock settings before evaluating artwork.
  createSymbolPreviewClock(definition,symbols,fps,first,last);
 },options);
 try{
  const clock=createSymbolPreviewClock(capture.definition,capture.project.symbols!,fps,first,last);
  capture.active();
  return {
   sample(frame:number,seconds:number,position:number){
    capture.active();
    if(!Number.isSafeInteger(frame)||frame<first||frame>last||!Number.isSafeInteger(position)||position<first||!Number.isFinite(seconds)||seconds<0)
     throw new Error('Invalid remembered symbol playback frame.');
    const frames=clock.sample(frame,seconds,position);
    const shapes=expandSymbols(capture.project,[capture.instance],frame,s=>frames['root/'+s.id+'/'+s.symbolId]??0);
    capture.active();return {frames,shapes};
   },
   dispose:capture.dispose,
  };
 }catch(error){capture.dispose();throw error;}
}
