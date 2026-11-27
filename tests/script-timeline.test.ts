import {expect,it} from 'vitest';
import {cloneScriptState,createScriptTimeline} from '../packages/scripting/src/timeline';

it('advances exact frames, loops and keeps paused ticks independent',()=>{
  const host=createScriptTimeline({duration:3,fps:24,seed:0}),api=host.api;
  host.advance();expect(api.currentFrame).toBe(1);
  api.stop();host.advance();expect(api.currentFrame).toBe(1);
  expect(host.checkpoint().tick).toBe(2);
  api.gotoAndPlay(2);host.advance();expect(api.currentFrame).toBe(0);
  api.gotoAndStop(2);host.advance();expect(api.currentFrame).toBe(2);
  api.play();host.advance();expect(api.currentFrame).toBe(0);
  expect(Object.isFrozen(api)).toBe(true);
  expect(api).not.toHaveProperty('random');
  expect(Object.isFrozen(host.runtime)).toBe(true);
});

it('replays stateful random and timeline commands from a detached JSON checkpoint',()=>{
  const host=createScriptTimeline({duration:7,fps:29.97,seed:123});
  host.runtime.random();host.advance();host.api.gotoAndStop(4);
  const checkpoint=JSON.parse(JSON.stringify(host.checkpoint()));
  function run(){
    const values=[];
    for(let i=0;i<100;i++){
      const n=host.runtime.random();values.push(n);
      if(n<0.2)host.api.gotoAndStop(Math.floor(n*7));
      else if(n>0.8)host.api.play();
      host.advance();
    }
    return {values,state:host.checkpoint()};
  }
  const first=run();host.restore(checkpoint);expect(run()).toEqual(first);
  checkpoint.frame=0;expect(host.api.currentFrame).toBe(first.state.frame);
  expect(first.values.every(n=>n>=0&&n<1)).toBe(true);
  expect(new Set(first.values).size).toBe(100);
});

it('rejects invalid commands and incompatible restores without partial changes',()=>{
  const host=createScriptTimeline({duration:3,fps:24,seed:0xffffffff});
  host.api.gotoAndStop(2);const before=host.checkpoint();
  for(const frame of [-1,3,0.5,NaN,Infinity]){
    expect(()=>host.api.gotoAndPlay(frame)).toThrow();expect(host.checkpoint()).toEqual(before);
  }
  for(const invalid of [null,[],{...before,version:2},{...before,duration:4},
    {...before,fps:30},{...before,seed:1},{...before,frame:3},{...before,playing:1},
    {...before,tick:NaN},{...before,randomState:-1},{...before,randomState:2**32}]){
    expect(()=>host.restore(invalid)).toThrow();expect(host.checkpoint()).toEqual(before);
  }
  host.restore({...before,tick:Number.MAX_SAFE_INTEGER});
  const full=host.checkpoint();expect(()=>host.advance()).toThrow();expect(host.checkpoint()).toEqual(full);
});

it('validates configuration without coercion and supports one-frame timelines',()=>{
  for(const config of [{duration:0,fps:24,seed:0},{duration:1.5,fps:24,seed:0},
    {duration:3,fps:Infinity,seed:0},{duration:3,fps:0,seed:0},{duration:3,fps:24,seed:0.5}]){
    expect(()=>createScriptTimeline(config)).toThrow();
  }
  const host=createScriptTimeline({duration:1,fps:24,seed:0});
  host.advance();expect(host.api.currentFrame).toBe(0);
  expect(host.runtime.random()).not.toBe(host.runtime.random());
});


it('clones bounded JSON state without invoking accessors or retaining aliases',()=>{
  const input={counter:2,nested:{values:[null,true,'hello',1.5]}};
  const copy=cloneScriptState(input);expect(copy).toEqual(input);
  input.nested.values[0]=false;expect(copy).not.toEqual(input);
  let accessed=false;const accessor={get value(){accessed=true;return 1;}};
  const cycle:Record<string,unknown>={};cycle.self=cycle;
  for(const value of [accessor,cycle,{value:NaN},{value:undefined},{value:new Date()},
    {value:new Array(2)},JSON.parse('{"__proto__":{}}'),{value:'é'.repeat(40000)},
    {value:'a'.repeat(65537)},{value:Array.from({length:10001},()=>0)}]){
    expect(()=>cloneScriptState(value)).toThrow();
  }
  expect(accessed).toBe(false);
  expect(Object.is(cloneScriptState({zero:-0}).zero,-0)).toBe(false);
  let deep:unknown={};for(let i=0;i<34;i++)deep={child:deep};
  expect(()=>cloneScriptState(deep)).toThrow();
});


it('enforces the exact UTF-8 JSON budget across escapes, keys and nested values',()=>{
  const state={'é"😀': [null,true,false,0,-0,1e21,1e-7,'😀漢é\u2028\u2029\b\t\n\f\r"\\\u0000\uD800'],padding:''};
  const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  state.padding='a'.repeat(65536-bytes(state));
  const detached=cloneScriptState(state);
  expect(bytes(detached)).toBe(65536);
  expect(JSON.stringify(detached)).toBe(JSON.stringify(state));
  for(const tail of ['a','é','😀','\u0000','\uD800'])
    expect(()=>cloneScriptState({...state,padding:state.padding+tail})).toThrow('Script state exceeds 64 KiB.');
});

it('rejects a declared array beyond the node budget before enumerating its keys',()=>{
  expect(cloneScriptState({items:new Array(9998).fill(0)}).items).toHaveLength(9998);
  let enumerated=false;
  const large=new Proxy(new Array(10000),{ownKeys(target){enumerated=true;return Reflect.ownKeys(target);}});
  expect(()=>cloneScriptState({items:large})).toThrow('Script state exceeds structural limits.');
  expect(enumerated).toBe(false);
  expect(()=>cloneScriptState({items:new Array(2)})).toThrow('Script state arrays must be dense.');
});

it('tracks successful seeks privately and can count a tick without skipping the destination',()=>{
  const host=createScriptTimeline({duration:4,fps:24,seed:1});
  expect(host.sought).toBe(false);
  expect(()=>host.api.gotoAndPlay(4)).toThrow();expect(host.sought).toBe(false);
  host.api.gotoAndPlay(2);expect(host.sought).toBe(true);
  host.advance(true);expect(host.checkpoint()).toMatchObject({frame:2,tick:1,playing:true});
  host.restore(host.checkpoint());expect(host.sought).toBe(false);
  host.advance();expect(host.checkpoint()).toMatchObject({frame:3,tick:2});
  expect('sought' in host.api).toBe(false);
});

it('resolves exact authored labels and rejects missing names or changed label checkpoints atomically', () => {
  const labels = [{ frame: 0, name: 'Start' }, { frame: 3, name: 'Reveal' }];
  const host = createScriptTimeline({ duration: 4, fps: 24, seed: 0, frameLabels: labels });
  labels[1].frame = 2;
  host.api.gotoAndStop('Reveal');
  expect(host.checkpoint()).toMatchObject({ frame: 3, playing: false });
  host.api.gotoAndPlay('Start');
  const before = host.checkpoint();
  expect(before).toMatchObject({ frame: 0, playing: true });
  expect(() => host.api.gotoAndStop('reveal')).toThrow('Unknown script frame label');
  expect(() => host.api.gotoAndStop('3')).toThrow('Unknown script frame label');
  const incompatible = { ...before, frameLabels: [{ frame: 0, name: 'Start' }, { frame: 2, name: 'Reveal' }] };
  expect(() => host.restore(incompatible)).toThrow('incompatible');
  expect(host.checkpoint()).toEqual(before);
  host.api.gotoAndStop(2);
  expect(host.api.currentFrame).toBe(2);
});
