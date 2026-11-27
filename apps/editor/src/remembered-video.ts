import {validateProject,type Project} from '../../../packages/document/src';
import {prepareRememberedTimelineCapture} from '../../../packages/animation/src/motion-capture';
import {videoCaptureSettings,type VideoCaptureOptions} from './video-settings';
/** Private evaluated capture; callers retain source, options and publication ownership. */
export async function prepareRememberedVideoProject(snapshot:Project,container:'ivf'|'webm'|'mp4',settings:VideoCaptureOptions={},options:{signal?:AbortSignal;validate?:()=>void}={}):Promise<Project>{
 const active=()=>{options.signal?.throwIfAborted();options.validate?.();options.signal?.throwIfAborted();};
 active();const source=validateProject(snapshot);videoCaptureSettings(source,container,settings);active();
 const prepared=await prepareRememberedTimelineCapture(source,{signal:options.signal,validate:active});active();return prepared;
}
