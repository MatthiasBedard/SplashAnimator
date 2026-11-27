import {cloneScriptState} from './timeline';

export interface ScriptButtonTarget {token:string;instanceId:string;symbolId:string;name:string;lifetime:number}
export interface ScriptButtonPointerInput {
  type:'pointerdown'|'pointerup'|'pointercancel';pointerId:number;button:number;target:ScriptButtonTarget|null;
}
export interface ScriptButtonPressCheckpoint {
  version:1;pressed:{pointerId:number;target:ScriptButtonTarget}|null;
}
function target(value:unknown):ScriptButtonTarget|null {
  if(value===null)return null;
  const copy=cloneScriptState(value);
  if(['token','instanceId','symbolId','name'].some(key=>typeof copy[key]!=='string')||
    !Number.isSafeInteger(copy.lifetime)||Number(copy.lifetime)<1)throw new Error('Invalid button target.');
  return {token:copy.token as string,instanceId:copy.instanceId as string,symbolId:copy.symbolId as string,
    name:copy.name as string,lifetime:copy.lifetime as number};
}
const pointerId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
export function copyScriptButtonPress(value:unknown):ScriptButtonPressCheckpoint {
  const copy=cloneScriptState(value);
  if(copy.version!==1)throw new Error('Invalid button press checkpoint.');
  if(copy.pressed===null)return {version:1,pressed:null};
  if(!copy.pressed||typeof copy.pressed!=='object'||Array.isArray(copy.pressed)||!pointerId(copy.pressed.pointerId))
    throw new Error('Invalid button press checkpoint.');
  const pressedTarget=target(copy.pressed.target);
  if(!pressedTarget)throw new Error('A pressed button requires a target.');
  return {version:1,pressed:{pointerId:copy.pressed.pointerId,target:pressedTarget}};
}
/** Pure preparation: the caller publishes the returned checkpoint only after its
 * script/artwork transaction succeeds. Bind checkpoints to that prepared project
 * and complete trajectory; lifetime numbers are not globally unique.
 * Only feed host-verified hit results here, never arbitrary script input metadata.
 */
export function advanceScriptButtonInput(checkpoint:ScriptButtonPressCheckpoint,input:ScriptButtonPointerInput){
  const next=copyScriptButtonPress(checkpoint),event=cloneScriptState(input);
  if(!['pointerdown','pointerup','pointercancel'].includes(String(event.type))||!pointerId(event.pointerId)||
    !Number.isInteger(event.button)||Number(event.button)<-1||Number(event.button)>31)throw new Error('Invalid button pointer input.');
  const hit=target(event.target);
  let activation:ScriptButtonTarget|null=null;
  if(event.type==='pointerdown'){
    // One primary press owns the gesture; other pointers/buttons cannot steal it.
    if(event.button===0&&!next.pressed&&hit)next.pressed={pointerId:event.pointerId,target:hit};
  }else if(next.pressed?.pointerId===event.pointerId){
    if(event.type==='pointercancel')next.pressed=null;
    else if(event.button===0){
      const down=next.pressed.target;
      if(hit&&hit.lifetime===down.lifetime&&hit.instanceId===down.instanceId&&hit.symbolId===down.symbolId)
        activation={...hit};
      next.pressed=null; // Outside, changed lifetime and changed target releases cancel too.
    }
  }
  return {checkpoint:next,activation};
}

/** A single accepted hover and press, local to one prepared artwork trajectory. */
export interface ScriptButtonHoverCheckpoint {
  version:1;press:ScriptButtonPressCheckpoint;hover:{pointerId:number;target:ScriptButtonTarget}|null;
}
export interface ScriptButtonHoverInput {
  type:ScriptButtonPointerInput['type']|'pointermove'|'pointerleave';
  pointerId:number;button:number;target:ScriptButtonTarget|null;
}
export function copyScriptButtonHover(value:unknown):ScriptButtonHoverCheckpoint {
  const copy=cloneScriptState(value);
  if(copy.version!==1)throw new Error('Invalid button hover checkpoint.');
  const press=copyScriptButtonPress(copy.press);
  let hover:ScriptButtonHoverCheckpoint['hover']=null;
  if(copy.hover!==null){
    if(!copy.hover||typeof copy.hover!=='object'||Array.isArray(copy.hover)||!pointerId(copy.hover.pointerId))
      throw new Error('Invalid button hover checkpoint.');
    const hit=target(copy.hover.target);
    if(!hit)throw new Error('A hovered button requires a target.');
    hover={pointerId:copy.hover.pointerId,target:hit};
  }
  if(press.pressed&&hover&&press.pressed.pointerId!==hover.pointerId)
    throw new Error('A pressed pointer owns button hover.');
  return {version:1,press,hover};
}
/** Prepare, do not publish. Inputs must carry host-verified hit metadata for the
 * exact displayed trajectory. Leaving clears hover but retains the accepted press;
 * release/cancel clears the press. Competing pointers cannot change an owned gesture.
 * No movement coalescing, DOM capture, script dispatch or clock advancement occurs here.
 */
export function copyScriptButtonHoverInput(input:unknown):ScriptButtonHoverInput{
  const event=cloneScriptState(input);
  if(!['pointerdown','pointerup','pointercancel','pointermove','pointerleave'].includes(String(event.type))||
    !pointerId(event.pointerId)||!Number.isInteger(event.button)||Number(event.button)<-1||Number(event.button)>31)
    throw new Error('Invalid button hover input.');
  return {type:event.type as ScriptButtonHoverInput['type'],pointerId:event.pointerId,button:event.button as number,target:target(event.target)};
}
export function advanceScriptButtonHover(checkpoint:ScriptButtonHoverCheckpoint,input:ScriptButtonHoverInput){
  const next=copyScriptButtonHover(checkpoint),event=copyScriptButtonHoverInput(input),hit=event.target;
  let activation:ScriptButtonTarget|null=null;
  const owns=!next.press.pressed||next.press.pressed.pointerId===event.pointerId;
  if(owns){
    if(event.type==='pointermove')next.hover=hit?{pointerId:event.pointerId,target:hit}:null;
    else if(event.type==='pointerleave'){
      if(next.hover?.pointerId===event.pointerId)next.hover=null;
    }else if(event.type==='pointercancel'){
      const step=advanceScriptButtonInput(next.press,{type:'pointercancel',pointerId:event.pointerId,button:event.button as number,target:null});
      next.press=step.checkpoint;
      if(next.hover?.pointerId===event.pointerId)next.hover=null;
    }else if(event.button===0){
      const step=advanceScriptButtonInput(next.press,{type:event.type as 'pointerdown'|'pointerup',pointerId:event.pointerId,button:0,target:hit});
      next.press=step.checkpoint;activation=step.activation;
      next.hover=hit?{pointerId:event.pointerId,target:hit}:null;
    }
  }
  const down=next.press.pressed?.target,over=next.hover?.target;
  const visual=over?{instanceId:over.instanceId,symbolId:over.symbolId,lifetime:over.lifetime,
    state:down&&down.instanceId===over.instanceId&&down.symbolId===over.symbolId&&down.lifetime===over.lifetime?'down' as const:'over' as const}:null;
  // Press and hover can duplicate target metadata; validate their combined output budget.
  return {checkpoint:copyScriptButtonHover(next),activation,visual};
}
