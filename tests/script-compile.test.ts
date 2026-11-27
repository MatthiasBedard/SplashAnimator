import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
import {compileFrameSource} from '../packages/scripting/src/compile';
import {createDebugLocalReader,debugLocalLimit,decodeDebugLocals} from '../packages/scripting/src/debug-locals';
import {scriptFrameFactoryEnd,scriptFrameFactoryStart,scriptWorkStepName} from '../packages/scripting/src/script-execution-host';
const es5Library=readFileSync(createRequire(import.meta.url).resolve('typescript/lib/lib.es5.d.ts'),'utf8');

it('checks standalone frames against timeline, runtime, state and JSON input',()=>{
  const compile=(source:string)=>compileFrameSource(source,es5Library,undefined,true);
  expect(compile('if(input.next === true) timeline.gotoAndStop("Done");state.value=runtime.random();').body).toBeDefined();
  expect(compile('stage?.setVisible("Actor",false);').diagnostics[0].message).toContain('stage');
  expect(compile('splashText.set("title","text");').diagnostics[0].message).toContain('splashText');
});
it('reports a removed timeline random call and allows a local runtime binding',()=>{
  expect(compileFrameSource('timeline.random();',es5Library).diagnostics).toContainEqual(
    expect.objectContaining({code:2339,message:expect.stringContaining('random')}),
  );
  const {body,diagnostics}=compileFrameSource('const runtime=7; state.local=runtime;',es5Library);
  expect(diagnostics).toEqual([]);
  const factory=new Function('return '+scriptFrameFactoryStart+body+scriptFrameFactoryEnd)();
  const state={};
  factory(undefined,{random:()=>0.25})({},state,{},undefined,()=>{});
  expect(state).toEqual({local:7});
});
it('exposes stage under its new name and preserves local bindings named stage',()=>{
  const unknown=compileFrameSource('state.width=splashStage?.width;',es5Library);
  expect(unknown.diagnostics).toContainEqual(expect.objectContaining({code:2304,message:expect.stringContaining('splashStage')}));
  const capability=Object.freeze({width:120});
  const run=(source:string)=>{
    const {body,diagnostics}=compileFrameSource(source,es5Library);
    expect(diagnostics).toEqual([]);
    const factory=new Function('return '+scriptFrameFactoryStart+body+scriptFrameFactoryEnd)();
    const state={};
    factory(capability)({},state,{},undefined,()=>{});
    return state;
  };
  expect(run('state.width=stage?.width ?? 0;')).toEqual({width:120});
  expect(run('const stage=7; state.local=stage;')).toEqual({local:7});
  const rawFactory=new Function('return '+scriptFrameFactoryStart+'return typeof splashStage;'+scriptFrameFactoryEnd)();
  expect(rawFactory(capability)()).toBe('undefined');
});
function executeCompiled(body:string,state:object,work:(kind:string)=>void=()=>{}){
  return new Function('timeline','state','input',scriptWorkStepName,'"use strict";\n'+body)({},state,{},work);
}
it('meters each authored loop kind and preserves labelled continue and break',()=>{
  const source=[
    'let visits=0;',
    'outer: for(let i=0;i<3;i++){ for(let j=0;j<3;j++){ visits++; continue outer; } }',
    'while(visits<5) visits++;',
    'do { visits++; } while(false);',
    'for(const key in {first:1,second:2}) if(key==="first") visits++;',
    'for(const value of [1,2,3]) { visits+=value; break; }',
    'state.visits=visits;',
  ].join('\n');
  for(const breakpoint of [undefined,2]){
    const result=compileFrameSource(source,undefined,breakpoint);
    expect(result.diagnostics).toEqual([]);
    const state={},steps= {count:0};
    const output=executeCompiled(result.body!,state,kind=>{if(kind==='loop')steps.count++;});
    if(breakpoint)while(!output.next().done){/* Step through the authored body. */}
    expect(steps.count).toBe(12);
    expect(state).toEqual({visits:8});
  }
  expect(compileFrameSource('const '+scriptWorkStepName+'=()=>0;').diagnostics[0]?.code).toBe(90006);
});
it('meters function, callback, constructor, accessor and method bodies without changing their dispatch',()=>{
  const source=[
    'function wrapper(){',
    '  "use strict";',
    '  const val=3;',
    '  return (function(){ return (()=>val)(); })();',
    '}',
    'class Base { value=1; }',
    'class Derived extends Base {',
    '  constructor(public offset:number){ super(); this.value+=this.offset; }',
    '  get data(){ return this.value; }',
    '  set data(value:number){ this.value=value; }',
    '  run(){ this.data+=wrapper(); return this.data; }',
    '}',
    'state.value=new Derived(1).run();',
  ].join('\n');
  const result=compileFrameSource(source,es5Library);
  expect(result.diagnostics).toEqual([]);
  const trace:string[]=[],state={};
  executeCompiled(result.body!,state,kind=>trace.push(kind));
  expect(state).toEqual({value:5});
  expect(trace.filter(kind=>kind==='enter')).toHaveLength(8);
  let depth=0;
  for(const kind of trace){depth+=kind==='enter'?1:-1;expect(depth).toBeGreaterThanOrEqual(0);}
  expect(depth).toBe(0);
});
it('does not charge synthetic local readers during an authored debugger pause',()=>{
  const result=compileFrameSource('function f(value:number){ const local=value+1; return local; }\nstate.value=f(2);',undefined,2);
  const trace:string[]=[],state={};
  const iterator=executeCompiled(result.body!,state,kind=>trace.push(kind));
  expect(iterator.next().done).toBe(false);
  const helper=iterator.next().value;
  expect(helper[4]).toBe(1);
  expect(trace).toEqual(['enter']);
  const inspect=createDebugLocalReader(debugLocalLimit);
  expect(decodeDebugLocals(inspect(helper[3],helper[1],helper[2])).values).toEqual([{name:'value',type:'number',value:'2'}]);
  expect(trace).toEqual(['enter']);
  while(!iterator.next().done){/* Complete the frame. */}
  expect(trace).toEqual(['enter','leave']);
  expect(state).toEqual({value:3});
});
it('instruments the chosen original top-level statement without discarding local values',()=>{
  const source='const amount:number=3;\r\nstate.n=amount;\r\n  state.n=Number(state.n)+amount; const future=6;\r\n// No stop here.\r\nstate.after=future;';
  const result=compileFrameSource(source,es5Library,3);
  expect(result.statementLocations).toEqual([{line:3,column:3},{line:3,column:35},{line:5,column:1}]);
  const state:{n?:number}={};
  const iter=executeCompiled(result.body!,state);
  expect(state).toEqual({});
  const first=iter.next();
  expect(first.done).toBe(false);
  expect(first.value.slice(0,3)).toEqual([0,1,0]);
  const bindings=first.value[3],snapshot=createDebugLocalReader(debugLocalLimit);
  expect(decodeDebugLocals(snapshot(bindings,1,0)).values).toEqual([{name:'amount',type:'number',value:'3'}]);
  expect(state).toEqual({n:3});
  expect(iter.next()).toEqual({done:false,value:[1,1,0]});
  expect(state).toEqual({n:6});
  expect(iter.next()).toEqual({done:false,value:[2,2,0]});
  expect(decodeDebugLocals(snapshot(bindings,2,0)).values.at(-1)).toEqual({name:'future',type:'number',value:'6'});
  expect(state).toEqual({n:6});
  expect(iter.next().done).toBe(true);
  expect(state).toEqual({n:6,after:6});
  expect(compileFrameSource(source,es5Library).body).not.toContain('yield');
  for(const [input,line] of [['// comment\nstate.n=1;',1],['if(true){\nstate.n=3;\n}',2],['type N = number;',1]] as const)
    expect(compileFrameSource(input,es5Library,line).diagnostics[0]?.message).toContain('executable top-level statement');
});
it('shows bounded scalar locals without reading object properties or invoking proxy traps',()=>{
  const bad=()=>{throw Error('The debugger must not inspect the object.');};
  const proxy=new Proxy({get value(){return bad();}},{get:bad,ownKeys:bad,getPrototypeOf:bad});
  const read=createDebugLocalReader(debugLocalLimit);
  expect(decodeDebugLocals(read([
    ['object',()=>proxy],['missing',()=>undefined],['negative',()=>-0],['infinity',()=>Infinity],
    ['message',()=>'"\\\n'],['large',()=>'"'.repeat(2000)],
  ],6,2))).toMatchObject({omitted:2,values:[
    {name:'object',value:'object'},{name:'missing',value:'undefined'},{name:'negative',value:'-0'},
    {name:'infinity',value:'Infinity'},{name:'message',value:JSON.stringify('"\\\n')},
    {name:'large',value:JSON.stringify('"'.repeat(256))+'…'},
  ]});
  expect(()=>decodeDebugLocals(JSON.stringify({omitted:0,values:[{name:'n',type:'number',value:'0'},{name:'n',type:'number',value:'1'}]})))
    .toThrow('Invalid debugger local value');
});
it('bounds debugger locals by UTF-8 bytes without a host encoder',()=>{
  const raw = '😀'.repeat(128);
  const bindings: [string, ()=>string][] = Array.from({length:debugLocalLimit},(_,index)=>['local'+index,()=>raw]);
  const payload = createDebugLocalReader(debugLocalLimit)(bindings,bindings.length,0);
  expect(new TextEncoder().encode(payload).byteLength).toBeLessThan(65536);
  const locals=decodeDebugLocals(payload);
  expect(locals.values[0]).toEqual({name:'local0',type:'string',value:JSON.stringify(raw)});
  expect(locals.omitted).toBeGreaterThan(0);
  expect(locals.omitted+locals.values.length).toBe(debugLocalLimit);
});
it('bounds the locals projection while the remaining source still executes',()=>{
  const source=Array.from({length:debugLocalLimit+1},(_,i)=>`const local${i}=${i};`).join('\n')+
    `\nstate.last=local${debugLocalLimit};`;
  const result=compileFrameSource(source,undefined,debugLocalLimit+2);
  const state:{last?:number}={};
  const iter=executeCompiled(result.body!,state);
  const marker=iter.next().value;
  expect(marker.slice(0,3)).toEqual([0,debugLocalLimit,1]);
  const preview=decodeDebugLocals(createDebugLocalReader(debugLocalLimit)(marker[3],marker[1],marker[2]));
  expect(preview.omitted).toBe(1);
  expect(preview.values).toHaveLength(debugLocalLimit);
  expect(iter.next().done).toBe(true);
  expect(state.last).toBe(debugLocalLimit);
});
it('keeps a rebound direct call on its authored target even when a debug copy exists',()=>{
  const source='function f(x:number){return x+1;}\nf=(x:number)=>x+10;\nstate.value=f(2);';
  const result=compileFrameSource(source,undefined,3);
  expect(result.debugFunctions).toEqual([{name:'f',points:[{line:1,column:22}],calls:[0]}]);
  const state={};
  const iter=executeCompiled(result.body!,state);
  expect(iter.next().done).toBe(false);
  expect(iter.next().done).toBe(true);
  expect(state).toEqual({value:12});
});
it('transpiles frame-local TypeScript without evaluating it and retains wrapper-aware maps',()=>{
  const source='const count: number = 2;\nstate.count = count;\ntimeline.gotoAndStop(count);';
  const result=compileFrameSource(source);
  expect(result.diagnostics).toEqual([]);expect(result.body).toContain('const count = 2;');
  expect(result.body).toContain('return __splashFrame(timeline,state,input);');
  const map=JSON.parse(result.sourceMap!);
  expect(map.sources).toEqual(['frame.ts']);expect(map.sourcesContent[0]).toContain(source);
  expect(result.sourceLineOffset).toBe(1);expect(map.mappings.length).toBeGreaterThan(0);
  expect(compileFrameSource('throw new Error("must not execute");').diagnostics).toEqual([]);
});
it('reports original syntax positions and rejects module/async syntax without output',()=>{
  const syntax=compileFrameSource('const good = 1;\nconst bad: = 2;');
  expect(syntax.body).toBeUndefined();expect(syntax.diagnostics.some(d=>d.line===2)).toBe(true);
  for(const source of ['import x from "x";','import("x");','await Promise.resolve();','namespace X {}','yield 1;','export const x = 1;','async function f() {}']){
    const result=compileFrameSource(source);expect(result.body).toBeUndefined();expect(result.diagnostics.length).toBeGreaterThan(0);
  }
  expect(compileFrameSource('x'.repeat(256*1024+1)).body).toBeUndefined();
});


it('checks timeline signatures, readonly properties and JSON state with user coordinates',()=>{
  const valid=compileFrameSource('const count = state.count;\nstate.count = typeof count === "number" ? count + 1 : 1;\ntimeline.gotoAndStop(2); timeline.play(); timeline.stop();\nstate.samples = [runtime.random(), timeline.currentFrame, timeline.totalFrames, timeline.fps, timeline.playing];',es5Library);
  expect(valid.diagnostics).toEqual([]);expect(valid.body).toBeDefined();
  for(const [source,code] of [
    ['timeline.gotoAndStop(false);',2345],['timeline.currentFrame = 2;',2540],
    ['timeline.advance();',2339],['state.callback = () => 1;',2322],
    ['state.missing.toFixed();',18049],['const n: number = "bad";',2322],
    ['document.title = "forbidden";',2584],
  ] as const){
    const result=compileFrameSource('const ok = 1;\n'+source,es5Library);
    expect(result.body).toBeUndefined();expect(result.sourceMap).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code,line:2})]));
  }
});
it('keeps semantic checking closed to external declarations and bounded',()=>{
  const external=compileFrameSource('/// <reference path="outside.d.ts" />\nconst x: ExternalSecret = 1;',es5Library);
  expect(external.body).toBeUndefined();expect(external.diagnostics.some(d=>d.message.includes('ExternalSecret'))).toBe(true);
  const errors=compileFrameSource(Array.from({length:100},(_,i)=>'timeline.bad'+i+'();').join('\n'),es5Library);
  expect(errors.diagnostics).toHaveLength(50);expect(errors.body).toBeUndefined();
  expect(compileFrameSource('throw new Error("not evaluated");',es5Library).diagnostics).toEqual([]);
});

it('types ephemeral input as recursively readonly JSON',()=>{
  expect(compileFrameSource('if(typeof input.key === "string") state.key=input.key;',es5Library).diagnostics).toEqual([]);
  for(const source of ['input.key="changed";','const list=input.items as readonly number[]; list[0]=1;']){
    expect(compileFrameSource(source,es5Library).body).toBeUndefined();
  }
});

it('types dynamic text updates as a binding and string value', () => {
  expect(compileFrameSource('splashText.set("message", "Ready");', es5Library).diagnostics).toEqual([]);
  expect(compileFrameSource('splashText.set("message", 17);', es5Library).diagnostics)
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: 2345, line: 1 })]));
  expect(compileFrameSource('splashText.setForInstance("left", "message", "Ready");', es5Library).diagnostics).toEqual([]);
  expect(compileFrameSource('splashText.setForInstance("left", "message", 17);', es5Library).diagnostics)
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: 2345, line: 1 })]));
});

it('types field deliveries as readonly value and selection events', () => {
  expect(compileFrameSource('if(input.textInput) state.saved={...input.textInput};', es5Library).diagnostics).toEqual([]);
  expect(compileFrameSource('if(input.textInput) input.textInput.value = "changed";', es5Library).diagnostics)
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: 2540, line: 1 })]));
});

it('checks script stage access and reports writes on the source line',()=>{
  expect(compileFrameSource('state.width=stage?.width ?? 0;',es5Library).diagnostics).toEqual([]);
  const source='if(stage) {\n  stage.height=10;\n}';
  expect(compileFrameSource(source,es5Library).diagnostics)
    .toEqual(expect.arrayContaining([expect.objectContaining({code:2540,line:2})]));
});

it('types named placement lookup and locates readonly display identity errors',()=>{
  const valid=compileFrameSource("const item=stage?.getInstance('hero','actors'); if(item)state.seen=item.visible;",es5Library);
  expect(valid.diagnostics).toEqual([]);
  expect(compileFrameSource("stage?.setChildVisible('panel','action',false);state.child=stage?.getChildInstance('panel','action')?.id??null;",es5Library).diagnostics).toEqual([]);
  const write=compileFrameSource("const item=stage?.getInstance('hero');\nif(item)item.symbolId='different';",es5Library);
  expect(write.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code:2540,line:2})]));
});
