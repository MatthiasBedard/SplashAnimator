import {expect,it} from 'vitest';
import {compileFrameSource} from '../packages/scripting/src/compile';
import {decodeCompiledFrame} from '../packages/scripting/src/compile-async';
import {originalFrameLocation} from '../packages/scripting/src/source-location';
it('maps emitted TypeScript lines through the frame wrapper without executing source',()=>{
  const result=compileFrameSource('const n: number = 1;\nthrow new Error("test");');
  const lines=result.body!.split('\n'),line=lines.findIndex(line=>line.includes('throw new Error'))+1;
  expect(originalFrameLocation(result.sourceMap!,line,5)).toEqual({line:2,column:1});
  expect(originalFrameLocation(result.sourceMap!,1,1)).toBeUndefined();
  expect(originalFrameLocation(result.sourceMap!,lines.length,1)).toBeUndefined();
});
it('rejects malformed, oversized, external and invalid coordinate maps',()=>{
  const map={version:3,sources:['frame.ts'],sourcesContent:['wrapper\nthrow 1;'],mappings:';AACA'};
  expect(originalFrameLocation(JSON.stringify(map),2,1)).toEqual({line:1,column:1});
  for(const text of ['{',' '.repeat(4*1024*1024+1),JSON.stringify({...map,sources:['other.ts']}),JSON.stringify({...map,mappings:';!'}),JSON.stringify({...map,mappings:';///////////A'})])
    expect(originalFrameLocation(text,2,1)).toBeUndefined();
  for(const line of [0,-1,NaN,Infinity,1.5])expect(originalFrameLocation(JSON.stringify(map),line,1)).toBeUndefined();
});
it('maps copied helper code and guarded call arguments to original BOM and CRLF coordinates',()=>{
  const source='\uFEFFfunction explode(value: number) {\r\n  throw new Error("boom " + value);\r\n}\r\nstate.result = explode(Number(state.value));';
  const compiled=decodeCompiledFrame(JSON.stringify(compileFrameSource(source,undefined,4)));
  const lines=compiled.body!.split('\n');
  const origin={source,spans:compiled.debugSourceSpans!};
  function locate(token:string){
    const row=lines.findIndex(line=>line.includes(token));
    expect(row).toBeGreaterThan(-1);
    return originalFrameLocation(compiled.sourceMap!,row+1,lines[row].indexOf(token)+1,1,origin);
  }
  expect(locate('new Error')).toEqual({line:2,column:9});
  expect(locate('Number(state.value)')).toEqual({line:4,column:24});
  expect(locate('yield [')).toBeUndefined();
  const row=lines.findIndex(line=>line.includes('new Error'));
  expect(originalFrameLocation(compiled.sourceMap!,row+1,lines[row].indexOf('new Error')+1,1,
    {...origin,source:source.replace('boom','oops')})).toBeUndefined();
  for(const spans of [[[0,0,2],[1,1,1]],[[-1,0,1]],[[0,0,0]],[[0,0,Number.MAX_SAFE_INTEGER]]])
    expect(()=>decodeCompiledFrame(JSON.stringify({...compiled,debugSourceSpans:spans}))).toThrow('Invalid compiler debug source spans.');
});
it.each(['\r','\r\n','\u2028','\u2029'])('maps an uninstrumented source with line separator %j',separator=>{
  const result=compileFrameSource('\uFEFFconst n = 1;'+separator+'  throw new Error("test");');
  const lines=result.body!.split('\n'),row=lines.findIndex(line=>line.includes('new Error'));
  expect(originalFrameLocation(result.sourceMap!,row+1,lines[row].indexOf('new Error')+1)).toEqual({line:2,column:9});
});
it('keeps authored error coordinates inside metered loop bodies',()=>{
  const source='for(let i=0;i<1;i++) {\n  throw new Error("loop body");\n}';
  for(const breakpoint of [undefined,1]){
    const compiled=compileFrameSource(source,undefined,breakpoint);
    const lines=compiled.body!.split('\n'),row=lines.findIndex(line=>line.includes('new Error'));
    const origin=compiled.debugSourceSpans?{source,spans:compiled.debugSourceSpans}:undefined;
    expect(originalFrameLocation(compiled.sourceMap!,row+1,lines[row].indexOf('new Error')+1,1,origin)).toEqual({line:2,column:9});
  }
});
