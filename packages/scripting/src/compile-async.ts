import type {CompiledFrame,FrameBreakpoint} from './compile';

const SOURCE_BYTES=256*1024, RESPONSE_BYTES=4*1024*1024;

/** Validate a bounded, data-only compiler response before exposing executable output. */
export function decodeCompiledFrame(value:unknown):CompiledFrame {
  if(typeof value!=='string'||value.length>RESPONSE_BYTES||new TextEncoder().encode(value).byteLength>RESPONSE_BYTES)
    throw new Error('Invalid compiler response.');
  const result=JSON.parse(value) as CompiledFrame;
  if(!result||result.sourceLineOffset!==1||!Array.isArray(result.diagnostics)||result.diagnostics.length>50||
    result.diagnostics.some(d=>!d||!Number.isSafeInteger(d.code)||typeof d.message!=='string'||d.message.length>2000||
      !Number.isSafeInteger(d.line)||d.line<1||!Number.isSafeInteger(d.column)||d.column<1))
    throw new Error('Invalid compiler diagnostics.');
  if(result.diagnostics.length){
    if(result.body!==undefined||result.sourceMap!==undefined||result.statementLocations!==undefined||
      result.debugFunctions!==undefined||result.debugSourceSpans!==undefined)throw new Error('Invalid compiler failure output.');
  }else if(typeof result.body!=='string'||new TextEncoder().encode(result.body).byteLength>SOURCE_BYTES||
    typeof result.sourceMap!=='string')throw new Error('Invalid compiled output.');
  function locations(points:FrameBreakpoint[]){
    if(!Array.isArray(points)||!points.length||points.some((point,i)=>
    !point||!Number.isSafeInteger(point.line)||point.line<1||!Number.isSafeInteger(point.column)||point.column<1||
    i>0&&(point.line<points[i-1].line||point.line===points[i-1].line&&point.column<=points[i-1].column)))
      throw new Error('Invalid compiler statement locations.');
    return points.map(({line,column})=>({line,column}));
  }
  const points=result.statementLocations===undefined?undefined:locations(result.statementLocations);
  const spans=result.debugSourceSpans;
  if(spans!==undefined){
    let previousEnd=0;
    if(!points||!Array.isArray(spans)||!spans.length||spans.some(span=>{
      if(!Array.isArray(span)||span.length!==3||!span.every(Number.isSafeInteger))return true;
      const [start,original,length]=span;
      if(start<previousEnd||original<0||length<1||original+length>SOURCE_BYTES||start+length>RESPONSE_BYTES)return true;
      previousEnd=start+length;
      return false;
    }))throw Error('Invalid compiler debug source spans.');
  }
  const occupied=new Set<number>();
  if(result.debugFunctions!==undefined&&(!points||!Array.isArray(result.debugFunctions)||!result.debugFunctions.length))
    throw Error('Invalid compiler function data.');
  const functions=result.debugFunctions?.map(fn=>{
    if(!fn||typeof fn.name!=='string'||!fn.name.length||fn.name.length>256||!Array.isArray(fn.calls)||!fn.calls.length)
      throw Error('Invalid compiler function data.');
    const calls=fn.calls.map(index=>{
      if(!Number.isSafeInteger(index)||index<0||index>=points!.length||occupied.has(index))
        throw Error('Invalid compiler function call site.');
      occupied.add(index);return index;
    });
    return {name:fn.name,points:locations(fn.points),calls};
  });
  return {body:result.body,sourceMap:result.sourceMap,sourceLineOffset:1,
    ...(points?{statementLocations:points}:{}),...(functions?{debugFunctions:functions}:{}),
    ...(spans?{debugSourceSpans:spans}:{}),
    diagnostics:result.diagnostics.map(({code,message,line,column})=>({code,message,line,column}))};
}

/** One disposable compiler worker per request; no user source is evaluated. */
export async function compileFrameSourceAsync(source:string,options:{signal?:AbortSignal;timeoutMs?:number;breakpointLine?:number;standalone?:true}={}):Promise<CompiledFrame> {
  const {signal,timeoutMs=10000,breakpointLine,standalone}=options;
  if(breakpointLine!==undefined&&(!Number.isSafeInteger(breakpointLine)||breakpointLine<1))throw Error('Invalid source breakpoint line.');
  if(typeof source!=='string'||source.length>SOURCE_BYTES||new TextEncoder().encode(source).byteLength>SOURCE_BYTES)
    throw new Error('Frame source exceeds 256 KiB.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid compiler deadline.');
  if(signal?.aborted)throw new DOMException('Compilation cancelled.','AbortError');
  return new Promise((resolve,reject)=>{
    let worker:Worker|undefined,finished=false;
    const finish=(error?:unknown,result?:CompiledFrame)=>{
      if(finished)return;
      finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
      if(error)reject(error);else resolve(result!);
    };
    const abort=()=>finish(new DOMException('Compilation cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Compilation timed out.')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      worker=new Worker(new URL('./compile-worker.ts',import.meta.url),{type:'module',name:'Splash TypeScript compiler'});
      worker.onmessage=event=>{try{
        const result=decodeCompiledFrame(event.data);
        if(!result.diagnostics.length&&result.statementLocations?.[0]?.line!==breakpointLine)throw Error('Compiler breakpoint does not match the request.');
        finish(undefined,result);
      }catch(error){finish(error);}};
      worker.onerror=event=>{event.preventDefault();finish(new Error('Compiler worker failed.'));};
      worker.onmessageerror=()=>finish(new Error('Compiler response could not be read.'));
      worker.postMessage(breakpointLine===undefined&&!standalone?source:{source,breakpointLine,standalone});
    }catch(error){finish(error);}
  });
}
