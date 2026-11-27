import {expect,it} from 'vitest';
import {advanceScriptButtonInput,copyScriptButtonPress,type ScriptButtonPointerInput,type ScriptButtonPressCheckpoint} from '../packages/scripting/src/button-input';
const initial:ScriptButtonPressCheckpoint={version:1,pressed:null};
const target={token:'compiled-a',instanceId:'instance',symbolId:'symbol',name:'Button',lifetime:1};
const event=(type:ScriptButtonPointerInput['type'],over:typeof target|null=target,pointerId=1,button=0):ScriptButtonPointerInput=>({type,pointerId,button,target:over});
it('prepares a detached press and activates once on the same logical target/lifetime despite compiled-token changes',()=>{
  const input=event('pointerdown',{...target}),down=advanceScriptButtonInput(initial,input);
  expect(initial.pressed).toBeNull();expect(down.activation).toBeNull();input.target!.name='edited';
  expect(down.checkpoint.pressed!.target.name).toBe('Button');
  const up=advanceScriptButtonInput(down.checkpoint,event('pointerup',{...target,token:'compiled-b'}));
  expect(up.activation).toEqual({...target,token:'compiled-b'});expect(up.checkpoint.pressed).toBeNull();
  expect(down.checkpoint.pressed).not.toBeNull();
  expect(advanceScriptButtonInput(up.checkpoint,event('pointerup')).activation).toBeNull();
  up.activation!.name='changed';expect(down.checkpoint.pressed!.target.name).toBe('Button');
});
it('cancels outside, mismatched instance/symbol and expired-lifetime releases without activation',()=>{
  const down=advanceScriptButtonInput(initial,event('pointerdown')).checkpoint;
  for(const hit of [null,{...target,lifetime:2},{...target,instanceId:'other'},{...target,symbolId:'other'}]){
    expect(advanceScriptButtonInput(down,event('pointerup',hit))).toEqual({checkpoint:initial,activation:null});
  }
  expect(advanceScriptButtonInput(down,event('pointercancel',null,1,-1))).toEqual({checkpoint:initial,activation:null});
});
it('ignores secondary buttons, unmatched releases and competing pointers without stealing the press',()=>{
  expect(advanceScriptButtonInput(initial,event('pointerdown',target,1,2)).checkpoint).toEqual(initial);
  expect(advanceScriptButtonInput(initial,event('pointerdown',null)).checkpoint).toEqual(initial);
  const down=advanceScriptButtonInput(initial,event('pointerdown')).checkpoint;
  for(const e of [event('pointerdown',{...target,lifetime:2},2),event('pointerup',target,2),event('pointercancel',null,2,-1),event('pointerup',target,1,2)])
    expect(advanceScriptButtonInput(down,e)).toEqual({checkpoint:down,activation:null});
});
it('restores JSON checkpoints and replays identical activation while abandoned preparation leaves state untouched',()=>{
  const down=advanceScriptButtonInput(initial,event('pointerdown')).checkpoint;
  const restored=copyScriptButtonPress(JSON.parse(JSON.stringify(down)));
  const a=advanceScriptButtonInput(down,event('pointerup')),b=advanceScriptButtonInput(restored,event('pointerup'));
  expect(a).toEqual(b);expect(down.pressed).not.toBeNull();
  const cancelled=advanceScriptButtonInput(down,event('pointercancel',null));
  expect(cancelled.checkpoint).toEqual(initial);expect(advanceScriptButtonInput(down,event('pointerup'))).toEqual(a);
});
it('rejects malformed checkpoints, inputs and unbounded/accessor targets before changing state',()=>{
  const down=advanceScriptButtonInput(initial,event('pointerdown')).checkpoint,before=JSON.stringify(down);
  for(const value of [{version:2,pressed:null},{version:1,pressed:{}},{version:1,pressed:{pointerId:1,target:null}},
    {version:1,pressed:{pointerId:-1,target}},{version:1,pressed:{pointerId:1,target:{...target,lifetime:0}}}])
    expect(()=>copyScriptButtonPress(value)).toThrow();
  for(const e of [{...event('pointerup'),pointerId:NaN},{...event('pointerup'),button:32},
    {...event('pointerup'),type:'click'},event('pointerup',{...target,name:'x'.repeat(65537)}),
    event('pointerup',{...target,get name():string{throw new Error('must not invoke');}})])
    expect(()=>advanceScriptButtonInput(down,e as ScriptButtonPointerInput)).toThrow();
  expect(JSON.stringify(down)).toBe(before);
});
