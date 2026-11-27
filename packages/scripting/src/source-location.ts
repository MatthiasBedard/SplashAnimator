/** Instrumented offset, authored offset and length of an unchanged UTF-16 slice. */
export type DebugSourceSpan=readonly [number,number,number];
export type DebugSourceOrigin={source:string;spans:readonly DebugSourceSpan[]};

function lineStarts(source:string){
  const starts=[0];
  for(const match of source.matchAll(/\r\n|[\r\n\u2028\u2029]/g))starts.push(match.index+match[0].length);
  return starts;
}

function lastAtOrBefore(length:number,offset:number,at:(index:number)=>number){
  let low=0,high=length;
  while(low<high){
    const mid=Math.floor((low+high)/2);
    if(at(mid)<=offset)low=mid+1;
    else high=mid;
  }
  return low-1;
}

export function debugSourceSpanAt(spans:readonly DebugSourceSpan[],offset:number){
  const span=spans[lastAtOrBefore(spans.length,offset,index=>spans[index][0])];
  return span&&offset<span[0]+span[2]?span:undefined;
}

function debugLocation(instrumented:string,offset:number,{source,spans}:DebugSourceOrigin){
  const span=debugSourceSpanAt(spans,offset);
  if(!span)return;
  const [start,original,length]=span;
  if(original+length>source.length||start+length>instrumented.length||
    instrumented.slice(start,start+length)!==source.slice(original,original+length))return;
  const authored=original+offset-start;
  const starts=lineStarts(source);
  const row=lastAtOrBefore(starts.length,authored,index=>starts[index]);
  return {line:row+1,column:authored-starts[row]+1};
}

/** Decode only bounded, single-source compiler maps. Locations are advisory diagnostics. */
export function originalFrameLocation(text:string,line:number,column:number,wrapperLines=1,debug?:DebugSourceOrigin):{line:number;column:number}|undefined{
  if(text.length>4*1024*1024||!Number.isSafeInteger(line)||line<1||!Number.isSafeInteger(column)||column<1)return;
  try{
    const map=JSON.parse(text);
    if(map.version!==3||map.sources?.length!==1||map.sources[0]!=='frame.ts'||typeof map.mappings!=='string'||typeof map.sourcesContent?.[0]!=='string')return;
    const content:string=map.sourcesContent[0];
    const sourceLines=content.split(/\r\n|[\r\n\u2028\u2029]/);
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let source=0,originalLine=0,originalColumn=0,segments=0;
    const lines=map.mappings.split(';');if(line>lines.length)return;
    for(let row=0;row<line;row++){
      let generated=0,found:{line:number;column:number}|undefined;
      for(const segment of lines[row].split(',')){
        if(!segment)continue;if(++segments>100000)return;
        const values:number[]=[];let value=0,shift=0;
        for(const char of segment){
          const digit=alphabet.indexOf(char);if(digit<0||shift>30)return;
          value+=(digit&31)*2**shift;
          if(digit&32){shift+=5;continue;}
          values.push((value%2?-1:1)*Math.floor(value/2));value=0;shift=0;
        }
        if(shift||![1,4,5].includes(values.length))return;
        generated+=values[0];if(generated<0)return;
        if(values.length===1){if(row===line-1&&generated<=column-1)found=undefined;continue;}
        source+=values[1];originalLine+=values[2];originalColumn+=values[3];
        if(source!==0||originalLine<0||originalLine>=sourceLines.length||originalColumn<0||originalColumn>sourceLines[originalLine].length)return;
        if(row===line-1&&generated<=column-1){
          found={line:originalLine,column:originalColumn};
        }
      }
      if(row===line-1&&found){
        if(debug)return debugLocation(content,lineStarts(content)[found.line]+found.column,debug);
        if(found.line>=wrapperLines)
          return {line:found.line+1-wrapperLines,column:found.column+1};
      }
    }
  }catch{/* Invalid maps never replace the underlying runtime error. */}
}
