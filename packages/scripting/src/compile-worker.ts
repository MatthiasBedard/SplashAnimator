import {compileFrameSource} from './compile';
import es5Library from 'typescript/lib/lib.es5.d.ts?raw';

// Trusted compiler only. Source is parsed, never evaluated in this realm.
self.onmessage=(event:MessageEvent<unknown>)=>{
  self.onmessage=null;
  try{
    const input=event.data;
    const source=typeof input==='string'?input:(input as {source?:unknown}|null)?.source;
    const line=typeof input==='string'?undefined:(input as {breakpointLine?:unknown}|null)?.breakpointLine;
    const standalone=typeof input!=='string'&&(input as {standalone?:unknown}|null)?.standalone===true;
    if(typeof source!=='string'||line!==undefined&&(typeof line!=='number'||!Number.isSafeInteger(line)||line<1))
      throw new Error('Invalid compiler request.');
    const response=JSON.stringify(compileFrameSource(source,es5Library,line,standalone));
    if(new TextEncoder().encode(response).byteLength>4*1024*1024)throw new Error("Compiler response exceeds budget.");
    self.postMessage(response);
  }catch{
    self.postMessage(null);
  }
};
