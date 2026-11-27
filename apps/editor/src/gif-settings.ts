import type {Project} from '@splash/document';
import {captureDimensions} from '../../../packages/export-web/src';
import {gifFrameDelays} from '../../../packages/export-video/src/gif-rgba';
export function gifCaptureSettings(project:Project,range?:{start:number;end:number},dither:'none'|'ordered'='none',compression:'literal'|'dictionary'='literal'){
  if(dither!=='none'&&dither!=='ordered')throw new Error('Invalid GIF dithering option.');
  if(compression!=='literal'&&compression!=='dictionary')throw new Error('Invalid GIF compression option.');
  const start=range?.start??0,end=range?.end??project.duration-1,count=end-start+1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=project.duration)throw new Error('Invalid GIF frame range.');
  const {width,height}=captureDimensions(project.width,project.height,1);
  // Keep the existing work limit until larger exports receive resource qualification.
  if(width*height*4*count>128*1024*1024)throw new Error('GIF RGBA frames exceed the 128 MiB capture budget. Choose a shorter range.');
  if(count*32>4*1024*1024)throw new Error('GIF replay digests exceed the 4 MiB verification budget. Choose a shorter range.');
  if(!globalThis.crypto?.subtle)throw new Error('GIF replay verification requires Web Crypto.');
  gifFrameDelays(count,project.fps,start);
  return {start,end,count,width,height};
}
