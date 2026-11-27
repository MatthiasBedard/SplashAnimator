import { expect, it } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import { renderData } from '../packages/stage/src/render-data';

const art:Vector={id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,
  fill:'#804020',stroke:'#102040',strokeWidth:2,points:[],opacity:.25,
  gradient:{kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[
    {offset:0,color:'#804020',opacity:0},{offset:1,color:'#ffffff',opacity:.5}]}};
it('brightens or darkens only RGB and retains geometry, per-stop alpha and source paint',()=>{
  const before=structuredClone(art);
  for(const [amount,color] of [[-.5,'#402010'],[.5,'#c0a090'],[-1,'#000000'],[1,'#ffffff']] as const){
    const painted=renderData({...art,paintBrightness:amount});
    expect(painted.fill).toBe(color);
    expect(painted.opacity).toBe(.25);
    expect(painted.commands).toEqual(renderData(art).commands);
    expect(painted.gradient!.stops[0]).toEqual({offset:0,color,opacity:0});
    expect(painted.gradient!.stops[1].opacity).toBe(.5);
  }
  expect(art).toEqual(before);
});
it('rejects invalid saved brightness and accepts older artwork',()=>{
  const p=newProject(); p.layers[0].keys[0].shapes=[{...art}];
  expect(validateProject(p)).toEqual(p);
  for(const value of [NaN,Infinity,-1.01,1.01]){
    p.layers[0].keys[0].shapes[0].paintBrightness=value;
    expect(()=>validateProject(p)).toThrow();
  }
});
