import {validateProject,type Project} from '../../../packages/document/src';
import {captureDimensions} from '../../../packages/export-web/src';
import {prepareRememberedTimelineCapture} from '../../../packages/animation/src/motion-capture';
import {pngSheetPages,type PNGFrameRange} from './export-png';

/** Admit PNG options before evaluating the render-only project. Actual encoding,
 * readiness, exact replay and raster/archive limits remain in the existing exporter. */
export async function prepareRememberedPNGProject(
 snapshot:Project,request:{frame:number|'sequence';range?:PNGFrameRange;scale:number;sheet?:boolean;padding?:number},
 options:{signal?:AbortSignal;validate?:()=>void}={},
):Promise<Project>{
 const active=()=>{options.signal?.throwIfAborted();options.validate?.();options.signal?.throwIfAborted();};
 active();const source=validateProject(snapshot);
 const {frame,range,scale,sheet,padding}=request,start=range?.start??0,end=range?.end??source.duration-1;
 if(range&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=source.duration))
  throw new Error('PNG range must be within the existing timeline.');
 if(frame!=='sequence'&&(!Number.isSafeInteger(frame)||frame<0||frame>=source.duration))
  throw new Error('Choose a frame within the existing timeline.');
 const output=captureDimensions(source.width,source.height,scale);
 if(sheet)pngSheetPages(output.width,output.height,end-start+1,padding??0);
 active();
 const prepared=await prepareRememberedTimelineCapture(source,{signal:options.signal,validate:active});
 active();return prepared;
}
