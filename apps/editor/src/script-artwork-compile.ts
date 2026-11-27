import type {Project} from '../../../packages/document/src';
import type {PresentationPose} from '../../../packages/export-web/src';
import {captureDynamicTextValues} from '../../../packages/document/src/dynamic-text';
import {captureReplayTextChanges,type ReplayTextChange} from '../../../packages/export-web/src/replay-text';
import {captureReplayTransforms,replayTransformByteLimit,replayTransformSize} from '../../../packages/animation/src/placement-transform';
import {captureSpawnArtwork,replaySpawnByteLimit,replaySpawnField,replaySpawnSize} from '../../../packages/animation/src/spawn-artwork';
import {replayWaveByteLimit} from '../../../packages/export-web/src/replay-wave';

/** Disposable trusted compiler; source is never evaluated here or in its worker. */
export async function compileScriptArtwork(project:Project,poses:readonly PresentationPose[],options:{signal?:AbortSignal;timeoutMs?:number;textValues?:unknown;playback?:true;replayCapture?:true;replayText?:readonly ReplayTextChange[];replayWave?:Uint8Array}={}):Promise<string>{
  const {signal,timeoutMs=10000}=options;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid artwork compiler deadline.');
  signal?.throwIfAborted();
  const replay=options.playback||options.replayCapture;
  const replayWave=options.playback?options.replayWave:undefined;
  if(replayWave!==undefined&&(!(replayWave instanceof Uint8Array)||replayWave.byteLength>replayWaveByteLimit))
    throw Error('Invalid replay WAV data.');
  const textValues=captureDynamicTextValues(options.textValues);
  const replayText=replay?captureReplayTextChanges(options.replayText,poses.length-1):undefined;
  let visibilityBytes=0,transformBytes=0,spawnBytes=0;
  let spawnSource:ReturnType<typeof captureSpawnArtwork>|undefined;
  const encoder=new TextEncoder();
  for(const pose of poses)for(const hidden of [pose.hiddenButtons,replay?pose.hiddenGraphics:undefined]){
    if(hidden===undefined)continue;
    visibilityBytes+=encoder.encode(JSON.stringify(hidden)).byteLength;
    if(visibilityBytes>64*1024*1024)throw Error('Presentation visibility exceeds the 64 MiB artwork compiler limit.');
  }
  const capturedPoses=poses.map(pose=>{
    const {frame,tick,buttonState,hiddenButtons,hiddenGraphics}=pose;
    const entries=replay?captureReplayTransforms(pose):undefined;
    const rawSpawns=replay?replaySpawnField(pose):undefined;
    let spawnedGraphics;
    if(rawSpawns!==undefined){
      spawnSource??=captureSpawnArtwork(project);
      spawnedGraphics=spawnSource.read(rawSpawns);
      spawnBytes+=replaySpawnSize(spawnedGraphics);
      if(spawnBytes>replaySpawnByteLimit)throw Error('Replay spawned artwork exceeds the 64 MiB artwork compiler limit.');
    }
    if(entries!==undefined){
      transformBytes+=replayTransformSize(entries);
      if(transformBytes>replayTransformByteLimit)throw Error('Replay transforms exceed the 64 MiB artwork compiler limit.');
    }
    return {frame,tick,buttonState,hiddenButtons,hiddenGraphics:replay?hiddenGraphics:undefined,
      ...(entries!==undefined?{placementTransforms:entries}:{}),...(spawnedGraphics!==undefined?{spawnedGraphics}:{})};
  });
  return new Promise((resolve,reject)=>{
    let worker:Worker|undefined,finished=false;
    const finish=(error?:unknown,html?:string)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
      if(error!==undefined)reject(error);else resolve(html!);
    };
    const abort=()=>finish(signal?.reason??new DOMException('Artwork compilation cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Script artwork compilation timed out.')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      worker=new Worker(new URL('./script-artwork-worker.ts',import.meta.url),{type:'module',name:'Splash artwork compiler'});
      worker.onmessage=event=>{
        const value=event.data;
        if(value?.ok!==true){finish(new Error(typeof value?.error==='string'?value.error.slice(0,2000):'Invalid artwork compiler response.'));return;}
        if(typeof value.html!=='string'||value.html.length>64*1024*1024||new TextEncoder().encode(value.html).byteLength>64*1024*1024){
          finish(new Error('Invalid or oversized artwork compiler output.'));return;
        }
        finish(undefined,value.html);
      };
      worker.onerror=event=>{event.preventDefault();finish(new Error('Artwork compiler worker failed.'));};
      worker.onmessageerror=()=>finish(new Error('Artwork compiler response could not be read.'));
      if(signal?.aborted){abort();return;}
      worker.postMessage({project,poses:capturedPoses,...(textValues===undefined?{}:{textValues}),...(replay?{playback:options.playback,replayCapture:options.replayCapture,replayText,replayWave}:{})});
    }catch(error){finish(error);}
  });
}
