import type {Project} from '@splash/document';
import {captureDimensions} from '../../../packages/export-web/src';
import {createIvfWriter} from '../../../packages/export-video/src/ivf';
import {createWebmWriter} from '../../../packages/export-video/src/webm';
import {prepareAvcEncoderSettings} from '../../../packages/export-video/src/avc-encoder';
/** Find a bounded rational whose floating representation equals the authored fps. */
export function videoTimebase(fps:number):{rate:number;scale:number}{
 if(!Number.isFinite(fps)||fps<1||fps>240)throw new Error('Invalid video frame rate.');
 let x=fps,h0=0,h1=1,k0=1,k1=0;
 for(let i=0;i<32;i++){
  const a=Math.floor(x),h=a*h1+h0,k=a*k1+k0;
  if(!Number.isSafeInteger(h)||!Number.isSafeInteger(k)||h>0xffffffff||k>0xffffffff)break;
  if(k>0&&h/k===fps)return {rate:h,scale:k};
  [h0,h1,k0,k1]=[h1,h,k1,k];x=1/(x-a);if(!Number.isFinite(x))break;
 }
 throw new Error('Video frame rate has no supported exact rational timebase.');
}

export interface VideoCaptureOptions{range?:{start:number;end:number};bitrate?:number;keyFrameInterval?:number;timeoutMs?:number;maxBytes?:number;progress?:(done:number,total:number)=>void}

/** Original capture/container admission without allocating a native encoder. */
export function videoCaptureSettings(project:Project,container:'ivf'|'webm'|'mp4',options:VideoCaptureOptions={}){
 const {bitrate=4000000,keyFrameInterval=1,timeoutMs=60000,maxBytes,progress}=options;
 const start=options.range?.start??0,end=options.range?.end??project.duration-1,count=end-start+1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=project.duration||end>=10001)
  throw new Error('Invalid video range or replay exceeds 10001 frame steps.');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid video export deadline.');
 const {width,height}=captureDimensions(project.width,project.height,1),{rate,scale}=videoTimebase(project.fps);
 if(width*height*4*count>128*1024*1024)throw new Error('Video RGBA frames exceed the 128 MiB capture budget. Choose a shorter range.');
 if((container!=='ivf'&&container!=='webm'&&container!=='mp4')||!Number.isSafeInteger(bitrate)||bitrate<1||bitrate>100000000||!Number.isSafeInteger(keyFrameInterval)||keyFrameInterval<1||keyFrameInterval>300)
  throw new Error('Invalid VP8 timing, bitrate or RGBA work budget.');
 // Reuse each container's original dimensions/timebase/byte-reservation rules.
 if(container==='mp4')prepareAvcEncoderSettings({width,height,frameCount:count,rate,scale,bitrate,keyFrameInterval},maxBytes);
 else if(container==='webm')createWebmWriter({width,height,frameCount:count,rate,scale},maxBytes).abort();
 else createIvfWriter({codec:'vp8',width,height,frameCount:count,rate,scale},()=>{},maxBytes).abort();
 return {bitrate,keyFrameInterval,timeoutMs,maxBytes,progress,start,end,count,width,height,rate,scale};
}
