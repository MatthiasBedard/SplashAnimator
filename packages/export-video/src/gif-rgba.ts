import {createIndexedGifEncoder,type IndexedGifAnimation} from './gif';
const orderedThresholds=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5] as const;

/** Round absolute frame boundaries, avoiding cumulative per-frame rounding drift.
 * Rates above 100 fps cannot retain every frame at GIF's centisecond resolution.
 */
export function gifFrameDelays(count:number,fps:number,startFrame=0):number[]{
  if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(startFrame)||startFrame<0||
    !Number.isSafeInteger(startFrame+count)||!Number.isFinite(fps)||fps<=0||fps>100)
    throw new Error('Invalid GIF frame count, range or rate (maximum 100 fps).');
  const boundary=(frame:number)=>Math.round(frame*100/fps);
  if(!Number.isSafeInteger(boundary(startFrame+count)))throw new Error('GIF timing exceeds numeric limits.');
  const delays:number[]=[];
  let previous=boundary(startFrame);
  for(let i=1;i<=count;i++){
    const next=boundary(startFrame+i),delay=next-previous;
    if(delay<1||delay>65535)throw new Error('GIF frame delay cannot represent this rate.');
    delays.push(delay);previous=next;
  }
  return delays;
}
export interface RgbaGifInput {
  width:number;height:number;frames:readonly (Uint8Array|Uint8ClampedArray)[];fps:number;startFrame?:number;
  /** Partial alpha is composited against this explicit RGB matte. */
  matte:readonly [number,number,number];
  /** Preserve exactly zero alpha as transparent; all other alpha is matte-composited. */
  transparent:boolean;
  loop?:boolean;
  compression?:'literal'|'dictionary';
  /** Fixed 4x4 ordered dithering, only when colors exceed the exact palette. */
  dither?:'none'|'ordered';
}
/** Exact shared colors when they fit; otherwise a deterministic 6x6x6 RGB cube.
 * Optional ordered dithering applies only to reduced palettes. Synchronous,
 * in-memory preparation only; maxIndexedBytes is an export allocation budget.
 */
export function prepareRgbaGif(input:RgbaGifInput,maxIndexedBytes=512*1024*1024):{animation:IndexedGifAnimation;quantized:boolean}{
  const plan=analyzeRgbaGif(input,maxIndexedBytes);
  const {frameCount,...header}=plan.header;
  const frames=Array.from({length:frameCount},(_,n)=>plan.indexFrame(n,new Uint8Array(plan.pixels)));
  return {animation:{...header,frames},quantized:plan.quantized};
}
/** Shared palette analysis followed by one reusable indexed-frame buffer.
 * RGBA input and complete encoded output remain in memory; aggregate indexed limits are unchanged.
 */
export function encodeRgbaGif(input:RgbaGifInput,maxBytes=512*1024*1024,maxIndexedBytes=512*1024*1024){
  const plan=analyzeRgbaGif(input,maxIndexedBytes);
  const encoder=createIndexedGifEncoder(plan.header,maxBytes),pixels=new Uint8Array(plan.pixels);
  for(let n=0;n<plan.header.frameCount;n++)encoder.append(plan.indexFrame(n,pixels));
  return {bytes:encoder.finish(),quantized:plan.quantized};
}
function analyzeRgbaGif(input:RgbaGifInput,maxIndexedBytes:number){
  const {width,height,frames,loop,compression}=input;
  if(loop!==undefined&&typeof loop!=='boolean')throw new Error('Invalid GIF loop option.');
  if(compression!==undefined&&compression!=='literal'&&compression!=='dictionary')throw new Error('Invalid GIF compression option.');
  if(!Array.isArray(frames)||!frames.length)throw new Error('GIF requires RGBA frames.');
  const analyzer=createGifPaletteAnalyzer(input,frames.length,maxIndexedBytes);
  const delays=gifFrameDelays(frames.length,input.fps,input.startFrame);
  for(const frame of frames)analyzer.append(frame);
  const plan=analyzer.finish();
  return {header:{width,height,palette:plan.palette,frameCount:frames.length,...(loop===undefined?{}:{loop}),...(compression===undefined?{}:{compression}),
    ...(input.transparent?{transparentIndex:0}:{})},pixels:width*height,quantized:plan.quantized,
    indexFrame:(n:number,output:Uint8Array)=>({pixels:plan.index(frames[n],output),delayCentiseconds:delays[n]})};
}
/** First pass retains only a bounded color table, never raster frames. Callers must replay
 * the same frames for indexing; exact-palette colors absent from analysis reject.
 * This checks palette compatibility, not exact frame replay or arbitrary-source determinism.
 */
export function createGifPaletteAnalyzer(settings:Pick<RgbaGifInput,'width'|'height'|'matte'|'transparent'|'dither'>,frameCount:number,maxIndexedBytes=512*1024*1024){
  if(!Array.isArray(settings.matte))throw new Error('Invalid GIF matte.');
  const {width,height,transparent,dither='none'}=settings,matte=[...settings.matte];
  if(dither!=='none'&&dither!=='ordered')throw new Error('Invalid GIF dithering option.');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65535||height>65535||
    !Number.isSafeInteger(frameCount)||frameCount<1||typeof transparent!=='boolean'||matte.length!==3||
    matte.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Invalid GIF raster or matte.');
  const pixels=width*height,total=pixels*frameCount;
  if(!Number.isSafeInteger(maxIndexedBytes)||maxIndexedBytes<1||!Number.isSafeInteger(total)||total>maxIndexedBytes)
    throw new Error('GIF indexed frames exceed the allocation budget.');
  const validate=(frame:Uint8Array|Uint8ClampedArray)=>{
    if(!(frame instanceof Uint8Array||frame instanceof Uint8ClampedArray)||frame.length!==pixels*4)
      throw new Error('GIF RGBA frame must cover the full logical screen.');
  };
  const color=(frame:Uint8Array|Uint8ClampedArray,i:number)=>{
    const alpha=frame[i+3];
    if(transparent&&alpha===0)return -1;
    const channel=(c:number)=>Math.round((frame[i+c]*alpha+matte[c]*(255-alpha))/255);
    return channel(0)*65536+channel(1)*256+channel(2);
  };
  const reserved=transparent?1:0,colors=new Map<number,number>();let quantized=false,accepted=0,finished=false;
  const append=(frame:Uint8Array|Uint8ClampedArray)=>{
    if(finished||accepted===frameCount)throw new Error('GIF palette has no remaining frames.');
    validate(frame);
    if(!quantized)for(let i=0;i<frame.length;i+=4){
      const rgb=color(frame,i);if(rgb<0||colors.has(rgb))continue;
      if(colors.size===256-reserved){quantized=true;break;}
      colors.set(rgb,colors.size+reserved);
    }
    accepted++;
  };
  const finish=()=>{
    if(finished)throw new Error('GIF palette is already finished.');
    if(accepted!==frameCount)throw new Error('GIF palette requires all declared frames.');
    const palette=new Uint8Array(Math.max(2,(quantized?216:colors.size)+reserved)*3);
    if(quantized){
      for(let r=0;r<6;r++)for(let g=0;g<6;g++)for(let b=0;b<6;b++)palette.set([r*51,g*51,b*51],(reserved+r*36+g*6+b)*3);
    }else for(const [rgb,index] of colors)palette.set([rgb>>>16,(rgb>>>8)&255,rgb&255],index*3);
    const index=(frame:Uint8Array|Uint8ClampedArray,output:Uint8Array=new Uint8Array(pixels))=>{
      validate(frame);
      if(!(output instanceof Uint8Array)||output.length!==pixels||output.buffer===frame.buffer)
        throw new Error('Invalid or overlapping GIF indexed output.');
      // Validate unseen exact colors before writing caller-owned scratch space.
      if(!quantized)for(let i=0;i<pixels;i++){
        const rgb=color(frame,i*4);if(rgb>=0&&!colors.has(rgb))throw new Error('GIF replay color was absent from palette analysis.');
      }
      for(let i=0;i<pixels;i++){
        const rgb=color(frame,i*4);
        // Anchor the threshold to raster coordinates, never frame number or traversal history.
        // Composite alpha first; transparent pixels bypass quantization entirely.
        const offset=dither==='ordered'?(orderedThresholds[(Math.floor(i/width)%4)*4+i%width%4]+0.5)/16-0.5:0;
        const level=(channel:number)=>Math.max(0,Math.min(5,Math.round(channel/51+offset)));
        output[i]=rgb<0?0:quantized?reserved+level(rgb>>>16)*36+level((rgb>>>8)&255)*6+level(rgb&255):colors.get(rgb)!;
      }
      return output;
    };
    finished=true;
    return {palette,quantized,index};
  };
  return {append,finish};
}
