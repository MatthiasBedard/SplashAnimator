import {validateProject,type Project} from '../../document/src';
import {prepareRememberedTimelineCapture} from '../../animation/src/motion-capture';
import {exportHTML,exportHTMLWithAudio,exportWebFolder} from './index';
import type {HTMLSoundtrack} from './html-soundtrack';
import type {WebCanvasSizing} from './web-folder';

/** Compile a detached remembered timeline into the existing script-free interactive
 * HTML runtime. The caller owns live-source validation and final publication. */
type Options = {signal?:AbortSignal;validate?:()=>void;soundtrack?:HTMLSoundtrack};

async function exportRemembered<T>(
 snapshot:Project, options:Options, compile:(project:Project)=>T,
):Promise<T>{
 const active=()=>{options.signal?.throwIfAborted();options.validate?.();options.signal?.throwIfAborted();};
 active();
 // Validate original values before the document validator's serialization clone.
 const source=validateProject(snapshot);active();
 const prepared=await prepareRememberedTimelineCapture(source,{signal:options.signal,validate:active});
 active();
 // Give cancellation and source changes a boundary before synchronous compilation.
 await new Promise<void>(resolve=>setTimeout(resolve,0));active();
 const result=compile(prepared);
 active();return result;
}

export function exportRememberedHTML(snapshot:Project, options:Options={}) {
 return exportRemembered(snapshot, options, project => options.soundtrack
   ? exportHTMLWithAudio(project, options.soundtrack) : exportHTML(project));
}

export function exportRememberedWebFolder(snapshot:Project, options:Options & {sizing?:WebCanvasSizing}={}) {
 return exportRemembered(snapshot, options, project => exportWebFolder(project, options.soundtrack, options.sizing));
}
