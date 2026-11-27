import {expect,it} from 'vitest';
import {clone,newProject,type Vector} from '../packages/document/src';
import {captureRememberedAuthoringFrame} from '../packages/animation/src/motion-owner';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';

function fixture(){
 const p=newProject(),layer=p.layers[0];p.duration=9;
 const art:Vector={id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 layer.keys=[{frame:0,shapes:[art]},{frame:6,shapes:[{...art,x:60}]}];createBasicMotionSpan(p,[layer.id],0,6,'linear');return p;
}
it('resolves detached sampled artwork by layer, recipe and ID without adopting display mutations',()=>{
 const p=fixture(),a=p.layers[0],b=clone(a);b.id='other';b.motionSpans![0].id='other-span';p.layers.push(b);
 a.keys[6].shapes[0].x=120;const original=clone(p),capture=captureRememberedAuthoringFrame(()=>({project:p,revision:4}),3);
 expect(capture.scene[0].key.shapes[0].x).toBe(60);expect(a.keys[3].shapes[0].x).toBe(30);
 capture.scene[0].key.shapes[0].id='forged';expect(()=>capture.resolve(a.id,'forged')).toThrow();
 expect(capture.resolve(a.id,'a')).toEqual({layerId:a.id,shapeId:'a',frame:3,start:0,end:6,spanId:a.motionSpans![0].id,revision:4});
 expect(capture.resolve(b.id,'a').spanId).toBe('other-span');expect(p).toEqual(original);capture.dispose();expect(()=>capture.resolve(a.id,'a')).toThrow(/disposed/);
});
it('rejects stale revisions, replacement sources and ownership or policy changes',()=>{
 for(const mode of ['revision','replacement','locked','hidden','layer','recipe','id','edited']){
  let p=fixture(),revision=0;const a=p.layers[0],capture=captureRememberedAuthoringFrame(()=>({project:p,revision}),3);
  if(mode==='revision')revision++;if(mode==='replacement')p=clone(p);if(mode==='locked')a.locked=true;if(mode==='hidden')a.visible=false;
  if(mode==='layer')p.layers.push(clone(a));if(mode==='recipe')a.motionSpans!.push({...a.motionSpans![0],id:'ambiguous'});if(mode==='id')a.motionSpans![0].id='replaced';if(mode==='edited')a.keys[2].shapes[0].x++;
  const before=clone(p);expect(()=>capture.resolve(a.id,'a')).toThrow();expect(p).toEqual(before);
 }
});
it('excludes authored, held, too-short, hidden, locked and duplicate artwork picks',()=>{
 for(const mode of ['authored','held','short','hidden','locked','duplicate']){
  const p=fixture(),a=p.layers[0];if(mode==='hidden')a.visible=false;if(mode==='locked')a.locked=true;
  if(mode==='duplicate'){for(const key of a.keys)key.shapes.push(clone(key.shapes[0]));a.motionSpans![0].baseline=JSON.stringify(a.keys.slice(1,-1));}
  const frame=mode==='authored'?6:mode==='held'?7:mode==='short'?1:3;
  const capture=captureRememberedAuthoringFrame(()=>({project:p,revision:0}),frame);expect(()=>capture.resolve(a.id,'a')).toThrow();
 }
});
it('checks source ownership after sampling and before returning the recipe',()=>{
 const p=fixture();let revision=0,count=0,flip=Infinity;const read=()=>({project:p,revision:++count===flip?++revision:revision});
 const capture=captureRememberedAuthoringFrame(read,3);flip=count+2;expect(()=>capture.resolve(p.layers[0].id,'a')).toThrow(/source changed/);
});

it('rejects duplicate root identities even if one of the layers was hidden at capture',()=>{
 const p=fixture(),hidden=clone(p.layers[0]);hidden.visible=false;hidden.motionSpans=[];p.layers.unshift(hidden);
 expect(()=>captureRememberedAuthoringFrame(()=>({project:p,revision:0}),3)).toThrow(/Ambiguous root track/);
});
