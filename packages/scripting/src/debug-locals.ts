export const debugLocalLimit = 128;
export const debugLocalNameLimit = 256;
const debugLocalTypes = ['string','number','boolean','undefined','null','object','function','bigint','symbol'];
export type DebugLocals = {values:{name:string;type:string;value:string}[];omitted:number};
type BindingReader = [name:string, read:()=>unknown];

/** Created in the worker before running source. Objects are never traversed. */
export function createDebugLocalReader(limit:number) {
  const text = String;
  const stringify = JSON.stringify.bind(JSON);
  const slice = Function.call.bind(String.prototype.slice) as (value:string,start:number,end:number)=>string;
  const isInteger = Number.isSafeInteger;
  const charCode = Function.call.bind(String.prototype.charCodeAt) as (value:string,index:number)=>number;
  function utf8Bytes(value:string) {
    let bytes=0;
    for(let i=0;i<value.length;i++){
      const code=charCode(value,i),next=charCode(value,i+1);
      if(code<=0x7f)bytes++;
      else if(code<=0x7ff)bytes+=2;
      else if(code>=0xd800&&code<=0xdbff&&next>=0xdc00&&next<=0xdfff){bytes+=4;i++;}
      else bytes+=3;
    }
    return bytes;
  }
  return (bindings:readonly BindingReader[], initialized:number, excluded:number):string => {
    if(!isInteger(initialized)||initialized<0||initialized>limit||initialized>bindings.length||
      !isInteger(excluded)||excluded<0)
      throw Error('Invalid debugger local scope.');
    let entries='',bytes=0,count=0;
    for(let i=0;i<initialized;i++){
      const pair=bindings[i],name=pair[0],read=pair[1];
      const raw=read();
      const type=raw===null?'null':typeof raw;
      let value:string=type;
      if(typeof raw==='string')value=raw.length>256?stringify(slice(raw,0,256))+'…':stringify(raw);
      if(typeof raw==='boolean'||typeof raw==='number')value=raw===0&&1/raw===-Infinity?'-0':text(raw);
      // Serialize primitives directly so no inherited toJSON hook can run.
      const entry='{"name":'+stringify(name)+',"type":'+stringify(type)+',"value":'+stringify(value)+'}';
      bytes+=utf8Bytes(entry)+1;
      if(bytes>64000)break;
      entries+=(count++?',':'')+entry;
    }
    return '{"values":['+entries+'],"omitted":'+(initialized-count+excluded)+'}';
  };
}

export function decodeDebugLocals(payload:unknown):DebugLocals {
  if(typeof payload!=='string'||payload.length>65536||new TextEncoder().encode(payload).byteLength>65536)
    throw Error('Invalid debugger local values.');
  const raw=JSON.parse(payload) as DebugLocals;
  const names=new Set<string>();
  if(!raw||!Number.isSafeInteger(raw.omitted)||raw.omitted<0||!Array.isArray(raw.values)||raw.values.length>debugLocalLimit)
    throw Error('Invalid debugger local values.');
  const values=raw.values.map(entry=>{
    if(!entry||typeof entry.name!=='string'||!entry.name.length||entry.name.length>debugLocalNameLimit||
      names.has(entry.name)||!debugLocalTypes.includes(entry.type)||typeof entry.value!=='string'||entry.value.length>1540)
      throw Error('Invalid debugger local value.');
    names.add(entry.name);
    return {name:entry.name,type:entry.type,value:entry.value};
  });
  return {values,omitted:raw.omitted};
}
