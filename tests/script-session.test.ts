import {expect,it} from 'vitest';
import {createScriptSession} from '../packages/scripting/src/session';
import {prepareNestedGraphics} from '../packages/scripting/src/nested-graphics';
const config={duration:3,fps:24,seed:9};
it('requires the original nested dispatch capability and own checkpoint data',async()=>{
  const nested=await prepareNestedGraphics({layers:[]},config.fps,config.seed,{});
  const session=createScriptSession(config,[],{},'entry',undefined,undefined,undefined,false,nested);
  const initial=session.checkpoint();
  const raw={...initial};
  let reads=0;
  Object.defineProperty(raw,'nestedGraphics',{enumerable:true,get(){reads++;return [];}});
  expect(()=>session.restore(raw)).toThrow(/Invalid nested graphic checkpoint/);
  expect(reads).toBe(0);
  expect(session.checkpoint()).toEqual(initial);
  const ordinary=createScriptSession(config,[],{},'entry');
  expect(()=>ordinary.restore(initial)).toThrow(/different script program/);
  expect((await session.run(1)).nestedGraphics).toEqual([]);
});
it('binds placed script checkpoints and dispatch to the selected execution mode', async () => {
  const ordinary = await prepareNestedGraphics({layers:[]},config.fps,config.seed,{});
  const bounded = await prepareNestedGraphics({layers:[]},config.fps,config.seed,{boundedEngine:true});
  expect(bounded.identity).not.toBe(ordinary.identity);
  expect(Reflect.set(ordinary,'boundedEngine',true)).toBe(false);
  expect(()=>createScriptSession(config,[],{},'entry',undefined,undefined,undefined,false,ordinary,true))
    .toThrow('Placed scripts must use the preview execution mode.');
  expect(()=>createScriptSession(config,[],{},'entry',undefined,undefined,undefined,false,bounded))
    .toThrow('Placed scripts must use the preview execution mode.');
  const admitted=createScriptSession(config,[],{},'entry',undefined,undefined,undefined,false,bounded,true);
  expect((await admitted.run(1)).nestedGraphics).toEqual([]);
});
it('commits a detached text field edit on a source-free frame and replays the same event', async () => {
  const sess = createScriptSession(config, [], {}, 'entry'), before = sess.checkpoint();
  const textInput = { binding: 'caption', value: 'a字b', selectionStart: 1, selectionEnd: 2,
    selectionDirection: 'backward' as const };
  const result = await sess.runWithPresentation(1, { events: [{ tick: 0, data: {}, textInput }] });
  expect(result.checkpoint.state.$splashText).toEqual({ caption: 'a字b' });
  expect(result.presentation[0].textValues).toBeUndefined();
  expect(result.presentation[1].textValues).toEqual({ caption: 'a字b' });
  const held = await sess.runWithPresentation(2);
  expect(held.presentation.map(sample => sample.textValues)).toEqual([{ caption: 'a字b' },undefined,undefined]);
  textInput.value = 'caller replaced';
  sess.restore(before);
  expect(await sess.run(1, { events: result.events })).toEqual(result.checkpoint);
});

it('rejects malformed text fields before consuming earlier events and keeps raw JSON separate', async () => {
  const sess = createScriptSession(config, []), before = sess.checkpoint();
  const textInput = { binding: 'caption', value: 'text', selectionStart: 1, selectionEnd: 2,
    selectionDirection: 'backward' as const };
  await expect(sess.run(2, { events: [{ tick: 0, data: {}, textInput },
    { tick: 1, data: {}, textInput: { ...textInput, selectionEnd: 30 } }] })).rejects.toThrow(/selection/);
  expect(sess.checkpoint()).toEqual(before);
  await expect(sess.run(1, { events: [{ tick: 0, data: { textInput } }] })).rejects.toThrow(/reserved/);
  expect(sess.checkpoint()).toEqual(before);
});
it('stops at host frame boundaries and returns only consumed detached inputs',async()=>{
  const session=createScriptSession(config,[],{},'entry');
  const result=await session.runWithPresentation(8,{stopAtFrames:[2],
    events:[{tick:0,data:{key:'first'}},{tick:2,data:{key:'later'}}],
    playback:[{tick:1,playing:true},{tick:3,playing:false}]});
  expect(result.presentation.map(p=>p.frame)).toEqual([0,1,2]);
  expect(result.checkpoint.timeline.tick).toBe(2);
  expect(result.stoppedAt).toBe(2);
  expect(result.events).toEqual([{tick:0,data:{key:'first'}}]);
  expect(result.playback).toEqual([{tick:1,playing:true}]);
  const held=await session.runWithPresentation(5,{stopAtFrames:[2],seeks:[{tick:2,frame:0,playing:true}]});
  expect(held.presentation).toHaveLength(1);expect(held.seeks).toEqual([]);
  expect(held.checkpoint).toEqual(result.checkpoint);
  const resumed=await session.runWithPresentation(3,{stopAtFrames:[1]});
  expect(resumed.presentation.map(p=>p.frame)).toEqual([2,0,1]);
  expect(resumed.stoppedAt).toBe(1);
});
it('validates complete stop/input batches before stopping and snapshots stop frames across yields',async()=>{
  const session=createScriptSession({duration:100,fps:24,seed:9},[]),before=session.checkpoint();
  for(const stops of [null,{},[-1],[100],[1.5],[NaN],Array(1),Array(1001).fill(0)]){
    await expect(session.run(100,{stopAtFrames:stops as number[]})).rejects.toThrow('stop frames');
    expect(session.checkpoint()).toEqual(before);
  }
  await expect(session.run(10,{stopAtFrames:[0],seeks:[{tick:9,frame:100,playing:true}]})).rejects.toThrow();
  expect(session.checkpoint()).toEqual(before);
  const stops=[40]; const running=session.runWithPresentation(80,{stopAtFrames:stops});
  stops[0]=50;
  expect((await running).checkpoint.timeline).toMatchObject({frame:40,tick:40});
});
it('retains seek dispatch semantics and rolls back a cancelled run-to-frame batch',async()=>{
  const session=createScriptSession({duration:100,fps:24,seed:9},[],{},'entry');
  const sought=await session.runWithPresentation(10,{stopAtFrames:[9],seeks:[{tick:0,frame:9,playing:false}]});
  expect(sought.checkpoint.timeline).toMatchObject({frame:9,tick:1,playing:false});
  expect(sought.seeks).toHaveLength(1);
  const before=session.checkpoint(),abort=new AbortController();
  const running=session.run(100,{stopAtFrames:[99],signal:abort.signal});
  abort.abort(new Error('cancel run-to-frame'));
  await expect(running).rejects.toThrow('cancel run-to-frame');
  expect(session.checkpoint()).toEqual(before);
});
it('binds checkpoints to exact source/config while detaching input and output',()=>{
  const frames=[{frame:2,source:'state.n++;'},{frame:0,source:'timeline.stop();'}],state={n:1};
  const session=createScriptSession(config,frames,state),saved=session.checkpoint();
  frames[0].source='changed';state.n=99;saved.state.n=88;
  expect(session.checkpoint().state.n).toBe(1);
  const same=createScriptSession(config,[{frame:0,source:'timeline.stop();'},{frame:2,source:'state.n++;'}]);
  same.restore(session.checkpoint());expect(same.checkpoint()).toEqual(session.checkpoint());
  const before=session.checkpoint();
  for(const checkpoint of [{...before,program:before.program+' '},{...before,version:2},{...before,timeline:{...before.timeline,fps:30}},{...before,state:{n:NaN}}]){
    expect(()=>session.restore(checkpoint as typeof before)).toThrow();expect(session.checkpoint()).toEqual(before);
  }
});
it('rejects invalid frame tables and program budgets',()=>{
  for(const frames of [[{frame:-1,source:''}],[{frame:3,source:''}],[{frame:0.5,source:''}],
    [{frame:0,source:''},{frame:0,source:''}],[{frame:0,source:'x'.repeat(256*1024)}]]){
    expect(()=>createScriptSession(config,frames)).toThrow();
  }
});
it('rejects invalid or cancelled batches before creating a browser realm',async()=>{
  const session=createScriptSession(config,[]),before=session.checkpoint();
  for(const ticks of [-1,0.5,1001,NaN])await expect(session.run(ticks)).rejects.toThrow();
  const controller=new AbortController();controller.abort();
  await expect(session.run(1,{signal:controller.signal})).rejects.toThrow();
  expect(await session.run(0)).toEqual(before);
});


it('binds entry dispatch to program identity and validates pending-entry checkpoints atomically',async()=>{
  const session=createScriptSession(config,[],{},'entry'),before=session.checkpoint();
  expect(before.entryPending).toBe(true);
  const tick=createScriptSession(config,[]);
  expect(()=>session.restore({...before,entryPending:false})).toThrow(/pending entry/);
  expect(()=>session.restore(tick.checkpoint())).toThrow(/program/);
  expect(()=>tick.restore(before)).toThrow(/program/);
  for(const value of [undefined,0,'false']){
    expect(()=>session.restore({...before,entryPending:value} as typeof before)).toThrow(/entry/);
    expect(session.checkpoint()).toEqual(before);
  }
  session.restore({...before,entryPending:false,timeline:{...before.timeline,playing:false}});
  const stopped=await session.run(1000);
  expect(stopped.timeline).toMatchObject({frame:0,tick:1000,playing:false});
  expect(stopped.entryPending).toBe(false);
});

it('advances source-free playing and stopped frames without browser execution and retains all poses',async()=>{
  for(const mode of ['tick','entry'] as const){
    const session=createScriptSession(config,[],{count:7},mode),initial=session.checkpoint();
    const result=await session.runWithPresentation(7);
    expect(result.presentation.map(p=>p.frame)).toEqual([0,1,2,0,1,2,0,1]);
    expect(result.presentation.map(p=>p.tick)).toEqual([0,1,2,3,4,5,6,7]);
    expect(result.checkpoint.state).toEqual({count:7});
    expect(result.checkpoint.timeline.randomState).toBe(initial.timeline.randomState);
    expect(result.checkpoint.entryPending).toBe(mode==='entry'?true:undefined);
    session.restore({...initial,timeline:{...initial.timeline,playing:false}});
    const stopped=await session.runWithPresentation(3);
    expect(stopped.presentation.map(p=>p.frame)).toEqual([0,0,0,0]);
    expect(stopped.checkpoint.entryPending).toBe(mode==='entry'?false:undefined);
  }
});

it('yields source-free batches for cancellation and rolls back overflow and invalid deadlines',async()=>{
  const session=createScriptSession(config,[],{count:7},'entry'),before=session.checkpoint();
  const controller=new AbortController(),pending=session.run(1000,{signal:controller.signal});
  controller.abort();await expect(pending).rejects.toThrow();expect(session.checkpoint()).toEqual(before);
  await expect(session.run(1,{timeoutMs:0})).rejects.toThrow(/deadline/);expect(session.checkpoint()).toEqual(before);
  const end={...before,timeline:{...before.timeline,tick:Number.MAX_SAFE_INTEGER-1}};
  session.restore(end);await expect(session.run(2)).rejects.toThrow(/Frame 2.*numeric limits/);
  expect(session.checkpoint()).toEqual(end);
  session.restore(before);expect((await session.run(3)).timeline.tick).toBe(3);
});

it('applies ordered absolute-tick seeks before advancement and returns detached replay inputs',async()=>{
  const session=createScriptSession(config,[],{n:4},'entry'),initial=session.checkpoint();
  const seeks=[{tick:0,frame:2,playing:false},{tick:2,frame:1,playing:true}];
  const result=await session.runWithPresentation(4,{seeks});
  expect(result.presentation.map(p=>p.frame)).toEqual([0,2,2,2,0]);
  expect(result.checkpoint.state).toEqual({n:4});
  seeks[0].frame=0;expect(result.seeks[0].frame).toBe(2);
  session.restore(initial);expect(await session.runWithPresentation(4,{seeks:result.seeks})).toEqual(result);
  result.seeks[0].frame=1;expect(session.checkpoint()).toEqual(result.checkpoint);
});

it('rejects invalid seek batches before mutation and snapshots inputs across cancellation yields',async()=>{
  const session=createScriptSession(config,[],{},'entry'),before=session.checkpoint();
  for(const seeks of [[{tick:-1,frame:0,playing:true}],[{tick:2,frame:0,playing:true}],
    [{tick:0,frame:3,playing:true}],[{tick:0,frame:0,playing:true},{tick:0,frame:1,playing:false}],
    [{tick:1,frame:0,playing:true},{tick:0,frame:1,playing:false}]]){
    await expect(session.run(2,{seeks})).rejects.toThrow(/seek/i);expect(session.checkpoint()).toEqual(before);
  }
  const seeks=[{tick:32,frame:2,playing:false}],pending=session.runWithPresentation(34,{seeks});
  seeks[0].frame=0;const result=await pending;expect(result.checkpoint.timeline.frame).toBe(2);
  await expect(session.run(1,{seeks:[{tick:0,frame:0,playing:true}]})).rejects.toThrow(/seek/i);
});

it('validates and detaches event batches before advancing, with aggregate payload bounds',async()=>{
  const session=createScriptSession(config,[],{},'entry'),before=session.checkpoint();
  for(const events of [[{tick:-1,data:{}}],[{tick:5,data:{}}],[{tick:0,data:{n:NaN}}],
    [{tick:0,data:{}},{tick:0,data:{}}],Array.from({length:5},(_,tick)=>({tick,data:{text:'x'.repeat(60000)}}))]){
    await expect(session.run(5,{events})).rejects.toThrow();expect(session.checkpoint()).toEqual(before);
  }
  const events=[{tick:32,data:{key:'a'}}],pending=session.runWithPresentation(34,{events});
  events[0].data.key='b';const result=await pending;expect(result.events[0].data.key).toBe('a');
  expect(result.checkpoint.state).toEqual({});
});

it('applies detached playback controls without inventing entry dispatch and replays exact poses',async()=>{
  const session=createScriptSession(config,[],{},'entry'),initial=session.checkpoint();
  const playback=[{tick:0,playing:false},{tick:2,playing:true}];
  const pending=session.runWithPresentation(4,{playback});playback[1].playing=false;
  const output=await pending;
  expect(output.presentation.map(p=>[p.frame,p.playing,p.entryPending])).toEqual([
    [0,true,true],[0,false,false],[0,false,false],[1,true,true],[2,true,true],
  ]);
  session.restore(initial);expect(await session.runWithPresentation(4,{playback:output.playback})).toEqual(output);
  output.playback[1].playing=false;expect(session.checkpoint().timeline.playing).toBe(true);
});
it('rejects the complete playback schedule and ambiguous seek commands before any execution',async()=>{
  const session=createScriptSession(config,[{frame:0,source:'throw new Error("must not execute");'}],{},'entry'),before=session.checkpoint();
  for(const playback of [[{tick:-1,playing:true}],[{tick:2,playing:true}],[{tick:0.5,playing:true}],
    [{tick:0,playing:true},{tick:0,playing:false}],[{tick:1,playing:true},{tick:0,playing:true}],
    [{tick:0,playing:1}],Array.from({length:1001},(_,tick)=>({tick,playing:true}))]){
    await expect(session.run(2,{playback:playback as {tick:number;playing:boolean}[]})).rejects.toThrow(/playback/);
    expect(session.checkpoint()).toEqual(before);
  }
  await expect(session.run(2,{playback:[{tick:0,playing:false}],seeks:[{tick:0,frame:1,playing:true}]})).rejects.toThrow(/both seek and playback/);
  expect(session.checkpoint()).toEqual(before);
});

it('binds checkpoints to detached stage metadata and rejects invalid dimensions',()=>{
  const stage={width:120,height:80,layerCount:2};
  const session=createScriptSession(config,[],{},'entry',undefined,stage);
  const before=session.checkpoint();
  stage.width=121;
  expect(session.checkpoint()).toEqual(before);
  const changed=createScriptSession(config,[],{},'entry',undefined,stage);
  expect(()=>changed.restore(before)).toThrow();
  for(const invalid of [{...stage,height:NaN},{...stage,width:-1},{...stage,layerCount:1.5}])
    expect(()=>createScriptSession(config,[],{},'entry',undefined,invalid)).toThrow(/stage/);
});
