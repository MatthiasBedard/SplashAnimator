import type {Point,SymbolDefinition} from '../../document/src';
import {expandSymbols} from '../../geometry/src/symbols';
import {hit} from '../../geometry/src';
import {compileButtonStatePlans,createButtonStateClock} from './button-state-clock';
import type {SymbolAuthoringSource} from './symbol-motion-owner';
import {prepareSymbolRememberedCapture,type RememberedSymbolCaptureOptions} from './symbol-remembered-capture';

type ButtonPose='up'|'over'|'down';
function mapping(definition:SymbolDefinition){
 const frames=definition.buttonStates??{up:0,over:1,down:2,hit:3},duration=definition.timeline?.duration??1;
 for(const name of ['up','over','down','hit']as const)
  if(!Number.isSafeInteger(frames[name])||frames[name]<0||frames[name]>=duration)
   throw new Error('Invalid remembered button state mapping.');
 return {...frames};
}

/** Private state session for the isolated button test. Hit is evaluated once at
 * its mapped frame with movie authoring poses, never with advancing state clocks.
 * This installs no handlers and does not route interactive descendants. */
export async function prepareSymbolRememberedButton(
 readSource:()=>SymbolAuthoringSource,fps:number,options:RememberedSymbolCaptureOptions={},
){
 const capture=await prepareSymbolRememberedCapture(readSource,fps,(definition,symbols)=>{
  mapping(definition);compileButtonStatePlans(definition,symbols,fps);
 },options);
 try{
  const frames=mapping(capture.definition);
  const clock=createButtonStateClock(capture.definition,capture.project.symbols!,fps);
  const artwork=(frame:number,movies?:Record<string,number>)=>expandSymbols(capture.project,[{
   ...capture.instance,symbolPlayback:{mode:'single',firstFrame:frame},
  }],0,shape=>movies?.['root/'+shape.id+'/'+shape.symbolId]??0);
  const frozenHit=artwork(frames.hit);
  capture.active();
  return {
   get mapping(){capture.active();return {...frames};},
   hitArtwork(){capture.active();const shapes=structuredClone(frozenHit);capture.active();return shapes;},
   contains(point:Point){
    capture.active();
    const original=point&&{x:point.x,y:point.y};
    if(!original||!Number.isFinite(original.x)||!Number.isFinite(original.y))throw new Error('Invalid remembered button Hit point.');
    const inside=frozenHit.some(shape=>hit(shape,original,0));capture.active();return inside;
   },
   sample(pose:ButtonPose,seconds:number){
    capture.active();
    if(!['up','over','down'].includes(pose)||!Number.isFinite(seconds)||seconds<0)
     throw new Error('Choose a button display state and finite nonnegative time.');
    const movies=clock.sample(frames[pose],seconds),shapes=artwork(frames[pose],movies);
    capture.active();return {frame:frames[pose],frames:movies,shapes};
   },
   origins(){capture.active();return clock.origins();},
   dispose:capture.dispose,
  };
 }catch(error){capture.dispose();throw error;}
}
