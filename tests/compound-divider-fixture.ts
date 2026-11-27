import type { Vector } from '../packages/document/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';

export const compoundPaint = '#ff5588';
export const brushInsert = '#ff0000';
export const ovalInserts = ['#0088ff', '#22bbbb'] as const;
const base:Vector={kind:'rectangle',id:'base',x:25,y:30,width:360,height:200,rotation:0,
  fill:compoundPaint,stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge'};

export function cutCompoundDivider(shapes:Vector[],x:number) {
  const stroke:Vector={...base,id:'cut-'+x,kind:'path',x:0,y:0,fillEnabled:false,strokeWidth:2,
    points:[{x,y:14},{x,y:270}]};
  return preparePencilDrawing(shapes,{stroke,mode:'ink',merge:true});
}

export function compoundDividerFixture() {
  const oval=(id:string,x:number,y:number,fill:string):Vector=>({...base,id,kind:'ellipse',x,y,width:32,height:27,fill});
  const remote:Vector={...base,id:'unrelated-curve',kind:'polygon',x:402,y:244,width:25,height:30,
    fill:'#668833',closed:true,fillRule:'evenodd',contours:[[
      {x:0,y:0,out:{x:7,y:-3}},{x:25,y:0,in:{x:18,y:-3}},{x:25,y:30},{x:0,y:30},
    ]]};
  const left=prepareShapeDrawing([base,remote],{shape:oval('blue',64,125,ovalInserts[0]),merge:true});
  const right=prepareShapeDrawing(left.shapes,{shape:oval('cyan',307,77,ovalInserts[1]),merge:true});
  const brush:Vector={...base,id:'brush',kind:'brush',x:0,y:0,fill:brushInsert,strokeWidth:20,
    points:[{x:72,y:78},{x:90,y:69},{x:102,y:73},{x:116,y:83}]};
  const painted=prepareBrushPaint(right.shapes,{brush,amount:1,merge:true,optimize:true,
    at:right.shapes.length,mode:'normal',selected:[]});
  const first=cutCompoundDivider(painted.shapes,150);
  const second=cutCompoundDivider(first.shapes,250);
  if ([left,right,painted,first,second].some(step=>step.retainedOverlap))
    throw Error('The compound drawing fixture has unresolved overlap.');
  return { compound:painted.shapes, divided:second.shapes, remote };
}
