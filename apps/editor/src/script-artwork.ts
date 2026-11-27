import type {ScriptButtonTarget} from '../../../packages/scripting/src/button-input';
import type {Project} from '../../../packages/document/src';
import type {PresentationPose} from '../../../packages/export-web/src';
import {compileScriptArtwork} from './script-artwork-compile';

/** A fresh, hidden, trusted artwork renderer. Stored user source remains inert. */
async function withScriptArtwork<T>(project:Project,poses:readonly PresentationPose[],signal:AbortSignal|undefined,consume:(canvas:HTMLCanvasElement)=>T|Promise<T>,textValues?:unknown):Promise<T>{
  signal?.throwIfAborted();
  const html=await compileScriptArtwork(project,poses,{signal,textValues});
  return withCompiledArtwork(html,signal,'capture',consume);
}

/** Readiness includes assets used only in an intermediate replay pose. */
export function verifyScriptReplayAssets(html:string,signal:AbortSignal):Promise<void>{
  return withCompiledArtwork(html,signal,'assets',()=>undefined);
}

export function withScriptReplayFrames<T>(html:string,signal:AbortSignal,consume:(canvas:HTMLCanvasElement)=>Promise<T>):Promise<T>{
  return withCompiledArtwork(html,signal,'assets',consume,60000);
}

async function withCompiledArtwork<T>(html:string,signal:AbortSignal|undefined,readiness:'assets'|'capture',consume:(canvas:HTMLCanvasElement)=>T|Promise<T>,timeoutMs=10000):Promise<T>{
  signal?.throwIfAborted();
  const host=document.createElement('iframe');host.hidden=true;host.title='Script artwork renderer';
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  const stopped=new Promise<never>((_,reject)=>{
    abort=()=>reject(signal?.reason??new DOMException('Artwork cancelled.','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    timer=setTimeout(()=>reject(new Error('Script artwork rendering timed out.')),timeoutMs);
  });
  try{
    const loaded=new Promise<void>((resolve,reject)=>{host.onload=()=>resolve();host.onerror=()=>reject(new Error('Artwork renderer failed to load.'));});
    host.srcdoc=html;document.body.append(host);await Promise.race([loaded,stopped]);
    let canvas:HTMLCanvasElement|null;
    while(true){
      signal?.throwIfAborted();canvas=host.contentDocument?.querySelector('canvas')??null;
      if(canvas?.dataset.capture==='error')throw new Error('Script artwork rendering failed.');
      if(canvas?.dataset[readiness]==='ready')break;
      await Promise.race([new Promise(resolve=>setTimeout(resolve,20)),stopped]);
    }
    signal?.throwIfAborted();
    const result=await Promise.race([Promise.resolve(consume(canvas!)),stopped]);
    signal?.throwIfAborted();return result;
  }finally{
    clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);
    host.onload=null;host.onerror=null;host.remove();
  }
}

export function renderScriptArtwork(project:Project,poses:readonly PresentationPose[],signal?:AbortSignal,textValues?:unknown):Promise<Blob>{
  return withScriptArtwork(project,poses,signal,canvas=>new Promise<Blob>((resolve,reject)=>
    canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Artwork encoding failed.')),'image/png')),textValues);
}

export type ScriptArtworkTarget = ScriptButtonTarget;
/** Queries only the final pose of this detached trajectory; no script or activation runs.
 * Callers must still reject stale document/trajectory results before delivering input.
 */
export async function queryScriptArtworkTargets(project:Project,poses:readonly PresentationPose[],points:readonly {x:number;y:number}[],
  options:{signal?:AbortSignal;timeoutMs?:number;textValues?:unknown}={}){
  const {signal,timeoutMs=10000,textValues}=options;
  signal?.throwIfAborted();
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid artwork query deadline.');
  if(!Array.isArray(points)||points.length<1||points.length>64)throw new Error('Query between one and 64 artwork points.');
  const locations=points.map(point=>{
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('Invalid artwork query coordinates.');
    return {x:point.x,y:point.y};
  });
  if(!Array.isArray(poses)||!poses.length)throw new Error('Artwork query requires a trajectory.');
  const trajectory=poses.map(pose=>({...pose})),last=trajectory[trajectory.length-1];
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>controller.abort(new Error('Script artwork query timed out.')),timeoutMs);
  try{
    const targets=await withScriptArtwork(project,trajectory,controller.signal,canvas=>{
      const query=(canvas as HTMLCanvasElement&{splashButtonAt?: (x:number,y:number)=>unknown}).splashButtonAt;
      if(typeof query!=='function')throw new Error('Artwork hit query is unavailable.');
      let bytes=0;
      return locations.map(({x,y}):ScriptArtworkTarget|null=>{
        controller.signal.throwIfAborted();const value=query(x,y);
        if(value===null)return null;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid artwork hit response.');
        const {token,instanceId,symbolId,name,lifetime}=value as Record<string,unknown>;
        if([token,instanceId,symbolId,name].some(field=>typeof field!=='string')||!Number.isSafeInteger(lifetime)||Number(lifetime)<1)throw new Error('Invalid artwork hit metadata.');
        const target={token,instanceId,symbolId,name,lifetime} as ScriptArtworkTarget;
        bytes+=new TextEncoder().encode(JSON.stringify(target)).byteLength;
        if(bytes>256*1024)throw new Error('Artwork hit responses exceed 256 KiB.');
        return target;
      });
    },textValues);
    return {frame:last.frame,tick:last.tick,points:locations,targets};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
