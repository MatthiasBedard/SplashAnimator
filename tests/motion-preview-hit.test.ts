import {expect,it} from 'vitest';
import {clone,newProject,type Vector} from '../packages/document/src';
import {worldPoint} from '../packages/geometry/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureRememberedAuthoringFrame} from '../packages/animation/src/motion-owner';
import {previewDocumentPoint,pickPreviewRoot} from '../apps/editor/src/motion-preview-hit';
it('maps scaled and letterboxed stills and excludes padding and the far edges',()=>{
 const box={left:30,top:40,width:100,height:100};
 expect(previewDocumentPoint({x:55,y:77.5},box,200,100)).toEqual({x:50,y:25});
 for(const [x,y] of [[30,64],[130,90],[60,115],[NaN,0]])expect(previewDocumentPoint({x,y},box,200,100)).toBeNull();
 expect(previewDocumentPoint({x:61,y:75},{left:0,top:0,width:200,height:100},100,100)).toEqual({x:11,y:75});
});
it('uses affine geometry and reverse root paint order, with explicit authored/locked occlusion',()=>{
 const p=newProject(),l=p.layers[0];p.duration=7;
 const shape:Vector={id:'lower',kind:'rectangle',x:100,y:50,width:30,height:10,rotation:90,transform:[1,0,0.3,1],fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 l.keys=[0,6].map(frame=>({frame,shapes:[clone(shape),{...clone(shape),id:'upper'}]}));
 createBasicMotionSpan(p,[l.id],0,6,'linear');const at=worldPoint(shape,{x:20,y:4});
 const read=()=>captureRememberedAuthoringFrame(()=>({project:p,revision:0}),3);
 expect(pickPreviewRoot(read(),at)).toMatchObject({kind:'pick',owner:{shapeId:'upper'}});
 expect(pickPreviewRoot(read(),{x:125,y:54})).toEqual({kind:'empty'});
 const front=clone(l);front.id='top';p.layers.push(front);expect(pickPreviewRoot(read(),at)).toMatchObject({kind:'pick',owner:{layerId:'top'}});
 front.locked=true;expect(pickPreviewRoot(read(),at)).toEqual({kind:'blocked'});
 front.locked=false;front.motionSpans=[];expect(pickPreviewRoot(read(),at)).toEqual({kind:'blocked'});
 for(const item of front.keys[3].shapes)item.opacity=0;expect(pickPreviewRoot(read(),at)).toMatchObject({kind:'pick',owner:{layerId:l.id}});
 front.visible=false;expect(pickPreviewRoot(read(),at)).toMatchObject({kind:'pick',owner:{shapeId:'upper'}});
});

it('point-picks the root opacity displayed on the still even when its authored value is zero',()=>{
 const p=newProject(),layer=p.layers[0];p.duration=7;
 const art:Vector={id:'lower',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 layer.keys=[0,6].map(frame=>({frame,shapes:[clone(art),{...clone(art),id:'upper',opacity:0}]}));createBasicMotionSpan(p,[layer.id],0,6,'linear');
 p.opacityBindings=[{layerId:layer.id,shapeId:'upper',start:2,end:4,keys:[{frame:2,opacity:1,ease:'hold'},{frame:4,opacity:0}]}];
 for(const [frame,id] of [[3,'upper'],[4,'lower']] as const){
  const capture=captureRememberedAuthoringFrame(()=>({project:p,revision:0}),frame);
  expect(pickPreviewRoot(capture,{x:5,y:5})).toMatchObject({kind:'pick',owner:{shapeId:id}});capture.dispose();
 }
});
