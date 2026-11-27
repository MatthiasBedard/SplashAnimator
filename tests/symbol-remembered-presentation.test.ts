import {expect,it} from 'vitest';
import {newProject,symbolLayers,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureSymbolRememberedAuthoringFrame,type SymbolAuthoringSource} from '../packages/animation/src/symbol-motion-owner';
function fixture(){
 const project=newProject();project.duration=12;const layer=project.layers[0];
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(project,[layer.id],0,8,'linear');
 const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='child-overlay';layer.keys[8].shapes[0].x=160;overlay.keys[8].shapes[0].x=240;
 const child={id:'child',name:'Child',width:300,height:50,shapes:layer.keys[0].shapes,buttonStates:{up:0,over:3,down:8,hit:10},
  timeline:{duration:12,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[overlay]}};
 const instance:Vector={...ink,id:'instance',kind:'symbol',symbolId:'child',width:300,height:50,symbolPlayback:{mode:'loop',firstFrame:0}};
 const parent={id:'parent',name:'Parent',width:300,height:100,shapes:[instance],timeline:{duration:12,keys:[]}};
 const state:SymbolAuthoringSource={definition:parent,symbols:[child,parent],revision:0,frame:4};
 return {state,child};
}
it('prepares fresh nested base/additional poses without changing roots, source or metadata',async()=>{
 const {state,child}=fixture(),before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const roots=structuredClone(capture.scene);capture.scene[0].key.shapes[0].symbolId='forged';
 const result=await capture.preparePresentation(),prepared=result.symbols.find(s=>s.id===child.id)!;
 expect(symbolLayers(prepared).map(l=>l.keys.find(k=>k.frame===4)!.shapes[0].x)).toEqual([80,120]);
 for(const [i,layer]of symbolLayers(prepared).entries()){
  const original=symbolLayers(child)[i];expect(layer.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(original.keys.filter(k=>[0,8,10].includes(k.frame)));
  expect(layer.motionSpans).toEqual(original.motionSpans);
 }
 expect(prepared.buttonStates).toEqual(child.buttonStates);expect(result.symbols.find(s=>s.id==='parent')).toEqual(state.definition);
 expect(state).toEqual(before);expect(roots[0].key.frame).toBe(0);
 prepared.shapes[0].x=999;expect((await capture.preparePresentation()).symbols.find(s=>s.id===child.id)!.shapes[0].x).toBe(0);
});
it('evaluates grandchildren while preserving hidden/unused stored data and independent settings',async()=>{
 const {state,child}=fixture(),grand=structuredClone(child);grand.id='grand';grand.timeline.motionSpans![0].id='grand-base';grand.timeline.layers[0].motionSpans![0].id='grand-overlay';
 const parentReference={...state.definition.shapes[0],id:'grand-instance',symbolId:'grand',symbolPlayback:{mode:'movie' as const,firstFrame:0}};
 child.timeline.layers.push({id:'reference',name:'Reference',visible:true,locked:false,keys:[{frame:0,shapes:[parentReference]}]});
 child.timeline.layers[0].visible=false;child.timeline.layers[0].keys[1].shapes[0].x++;
 const unused=structuredClone(grand);unused.id='unused';unused.timeline.keys[0].shapes[0].x++;
 state.symbols.push(grand,unused);const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 const {symbols}=await capture.preparePresentation();
 expect(symbols.find(s=>s.id==='grand')!.timeline!.keys.find(k=>k.frame===4)!.shapes[0].x).toBe(80);
 expect(symbols.find(s=>s.id==='child')!.timeline!.layers![0]).toEqual(child.timeline.layers[0]);
 expect(symbols.find(s=>s.id==='child')!.timeline!.layers![1].keys[0].shapes[0].symbolPlayback).toEqual({mode:'movie',firstFrame:0});
 expect(symbols.find(s=>s.id==='unused')).toEqual(unused);expect(state).toEqual(before);
});
for(const mode of ['edited','missing','later']as const)it('rejects '+mode+' nested artwork before publishing presentation',async()=>{
 const {state,child}=fixture();
 if(mode==='edited')child.timeline.keys[0].shapes[0].x++;
 if(mode==='later')child.timeline.layers[0].keys[1].shapes[0].x++;
 if(mode==='missing')state.definition.shapes[0].symbolId='missing';
 const before=structuredClone(state),capture=captureSymbolRememberedAuthoringFrame(()=>state);
 await expect(capture.preparePresentation()).rejects.toThrow();expect(state).toEqual(before);
});
for(const mode of ['abort','source','library','frame','dispose','validation']as const)it('rejects pending nested preparation after '+mode,async()=>{
 const {state}=fixture(),capture=captureSymbolRememberedAuthoringFrame(()=>state),controller=new AbortController();
 const before=structuredClone(state.definition),job=capture.preparePresentation({signal:controller.signal,validate:()=>{if(mode==='validation')throw new Error('Enclosing source changed.');}});
 if(mode==='abort')controller.abort();if(mode==='source')state.revision++;if(mode==='library')state.symbols[0].name='Changed';if(mode==='frame')state.frame++;if(mode==='dispose')capture.dispose();
 await expect(job).rejects.toThrow();expect(state.definition).toEqual(before);
});
it('retains read-only locked child track metadata',async()=>{
 const {state,child}=fixture();child.timeline.layers[0].locked=true;
 const capture=captureSymbolRememberedAuthoringFrame(()=>state),{symbols}=await capture.preparePresentation();
 expect(symbols.find(s=>s.id==='child')!.timeline!.layers![0]).toMatchObject({locked:true});
 expect(symbols.find(s=>s.id==='child')!.timeline!.layers![0].keys[4].shapes[0].x).toBe(120);
 expect(child.timeline.layers[0].keys[4].shapes[0].x).toBe(40);
});
