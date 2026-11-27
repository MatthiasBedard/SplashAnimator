import {validateProject,type Project} from '../../../packages/document/src';
import {prepareRememberedTimelineCapture} from '../../../packages/animation/src/motion-capture';
import {gifCaptureSettings} from './gif-settings';

/** Evaluate once before either exact-frame GIF replay pass. Source/publication
 * ownership stays with the caller; codec and resource admission is shared. */
export async function prepareRememberedGIFProject(
 snapshot:Project,settings:{range?:{start:number;end:number};dither:'none'|'ordered';compression:'literal'|'dictionary'},
 options:{signal?:AbortSignal;validate?:()=>void}={},
):Promise<Project>{
 const active=()=>{options.signal?.throwIfAborted();options.validate?.();options.signal?.throwIfAborted();};
 active();const source=validateProject(snapshot);
 gifCaptureSettings(source,settings.range,settings.dither,settings.compression);active();
 const prepared=await prepareRememberedTimelineCapture(source,{signal:options.signal,validate:active});
 active();return prepared;
}
