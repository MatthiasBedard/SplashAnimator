import {expect,it} from 'vitest';
import {advanceScriptButtonHover,copyScriptButtonHover,type ScriptButtonHoverCheckpoint,type ScriptButtonHoverInput} from '../packages/scripting/src/button-input';
const initial:ScriptButtonHoverCheckpoint={version:1,press:{version:1,pressed:null},hover:null};
const target={token:'a',instanceId:'instance',symbolId:'symbol',name:'Button',lifetime:1};
const event=(type:ScriptButtonHoverInput['type'],hit:typeof target|null=target,pointerId=1,button=0):ScriptButtonHoverInput=>({type,pointerId,button,target:hit});
it('prepares Over, Down, drag-out Up, drag-in Down and released Over without losing a press',()=>{
  const over=advanceScriptButtonHover(initial,event('pointermove'));
  expect(over.visual?.state).toBe('over');expect(initial.hover).toBeNull();
  const down=advanceScriptButtonHover(over.checkpoint,event('pointerdown'));
  expect(down.visual?.state).toBe('down');
  const outside=advanceScriptButtonHover(down.checkpoint,event('pointerleave',null));
  expect(outside.visual).toBeNull();expect(outside.checkpoint.press).toEqual(down.checkpoint.press);
  const inside=advanceScriptButtonHover(outside.checkpoint,event('pointermove',{...target,token:'new-compiled'}));
  expect(inside.visual?.state).toBe('down');
  const released=advanceScriptButtonHover(inside.checkpoint,event('pointerup'));
  expect(released.visual?.state).toBe('over');expect(released.activation).toEqual(target);expect(released.checkpoint.press.pressed).toBeNull();
  expect(advanceScriptButtonHover(released.checkpoint,event('pointerup')).activation).toBeNull();
});
it('clears hover on misses/cancel and never activates a different or reentered lifetime',()=>{
  const down=advanceScriptButtonHover(initial,event('pointerdown')).checkpoint;
  expect(advanceScriptButtonHover(down,event('pointermove',null)).visual).toBeNull();
  for(const hit of [null,{...target,lifetime:2},{...target,instanceId:'other'},{...target,symbolId:'other'}]){
    const moved=advanceScriptButtonHover(down,event('pointermove',hit));
    expect(moved.visual?.state??null).toBe(hit?'over':null);
    expect(moved.checkpoint.press).toEqual(down.press);
    const up=advanceScriptButtonHover(moved.checkpoint,event('pointerup',hit));
    expect(up.activation).toBeNull();expect(up.checkpoint.press.pressed).toBeNull();
  }
  expect(advanceScriptButtonHover(down,event('pointercancel',target)).checkpoint).toEqual(initial);
});
it('protects the owning pointer against competing gestures and secondary buttons',()=>{
  const down=advanceScriptButtonHover(initial,event('pointerdown')).checkpoint;
  for(const type of ['pointermove','pointerleave','pointerdown','pointerup','pointercancel'] as const){
    const result=advanceScriptButtonHover(down,event(type,null,2));
    expect(result.checkpoint).toEqual(down);expect(result.visual?.state).toBe('down');expect(result.activation).toBeNull();
  }
  for(const type of ['pointerdown','pointerup'] as const)
    expect(advanceScriptButtonHover(down,event(type,null,1,2)).checkpoint).toEqual(down);
  const over=advanceScriptButtonHover(initial,event('pointermove')).checkpoint;
  expect(advanceScriptButtonHover(over,event('pointerleave',null,2)).checkpoint).toEqual(over);
  expect(advanceScriptButtonHover(over,event('pointermove',target,2)).checkpoint.hover?.pointerId).toBe(2);
});
it('detaches checkpoints and outputs, and permits replay or abandoned transitions',()=>{
  const input=event('pointerdown',{...target});
  const down=advanceScriptButtonHover(initial,input);input.target!.name='changed';
  expect(down.checkpoint.press.pressed!.target.name).toBe('Button');
  const before=JSON.stringify(down.checkpoint),restored=copyScriptButtonHover(JSON.parse(before));
  const up=advanceScriptButtonHover(restored,event('pointerup'));
  expect(up).toEqual(advanceScriptButtonHover(down.checkpoint,event('pointerup')));
  up.activation!.name='mutated';up.checkpoint.hover!.target.name='mutated';
  expect(JSON.stringify(down.checkpoint)).toBe(before);
  advanceScriptButtonHover(down.checkpoint,event('pointercancel',null));
  expect(JSON.stringify(down.checkpoint)).toBe(before);
});
it('rejects malformed, accessor and oversized checkpoints/events before changing state',()=>{
  const down=advanceScriptButtonHover(initial,event('pointerdown')).checkpoint,before=JSON.stringify(down);
  for(const value of [{...initial,version:2},{...initial,hover:{}},{...initial,hover:{pointerId:1,target:null}},
    {...down,hover:{pointerId:2,target}},{...initial,hover:{pointerId:1,target:{...target,lifetime:0}}}])
    expect(()=>copyScriptButtonHover(value)).toThrow();
  for(const value of [{...event('pointermove'),pointerId:-1},{...event('pointermove'),button:32},
    {...event('pointermove'),type:'click'},event('pointermove',{...target,name:'x'.repeat(65537)}),
    event('pointermove',{...target,get name():string{throw new Error('must not invoke');}})])
    expect(()=>advanceScriptButtonHover(down,value as ScriptButtonHoverInput)).toThrow();
  expect(JSON.stringify(down)).toBe(before);
});

it('rejects duplicated target metadata beyond the checkpoint budget atomically',()=>{
  const large={...target,name:'x'.repeat(40000)};
  const hover=advanceScriptButtonHover(initial,event('pointermove',large));
  expect(hover.checkpoint.hover!.target.name.length).toBe(40000);
  const before=JSON.stringify(hover.checkpoint);
  expect(()=>advanceScriptButtonHover(hover.checkpoint,event('pointerdown',large))).toThrow();
  expect(JSON.stringify(hover.checkpoint)).toBe(before);
});
