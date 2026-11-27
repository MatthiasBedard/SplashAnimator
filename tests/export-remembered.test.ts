import {expect,it} from 'vitest';
import {newProject,setFrameScript,type Vector} from '../packages/document/src';
import {createBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {exportRememberedHTML} from '../packages/export-web/src/remembered';
function fixture(){
 const p=newProject();p.width=200;p.height=100;p.duration=12;p.fps=10;
 const ink:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};
 const root=p.layers[0];root.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,[root.id],0,8,'linear');root.keys[8].shapes[0].x=160;
 const child={id:'child',name:'Child',width:200,height:100,shapes:structuredClone(root.keys[0].shapes),timeline:{duration:12,keys:structuredClone(root.keys.slice(1)),motionSpans:structuredClone(root.motionSpans)}};
 p.symbols=[child];p.layers.push({id:'movie',name:'Movie',visible:true,locked:false,keys:[{frame:0,shapes:[{...ink,id:'instance',kind:'symbol',symbolId:'child',width:200,height:100,symbolPlayback:{mode:'movie',firstFrame:0}}]}]});
 return p;
}
function data(html:string){return JSON.parse(html.slice(html.indexOf('\nconst p=')+9,html.indexOf(',c=document.querySelector'))) as {layers:{keys:{frame:number;shapes:Vector[]}[]}[];sharedArtwork:{frames:number[];poses:Vector[][]}[];opacityChannels:unknown[]};}
it('exports freshly evaluated root and child artwork without changing source keys or settings',async()=>{
 const p=fixture(),before=structuredClone(p),out=data(await exportRememberedHTML(p));
 expect(out.layers[0].keys.find(k=>k.frame===4)!.shapes[0].x).toBe(80);expect(out.layers[0].keys.find(k=>k.frame===8)!.shapes[0].x).toBe(160);expect(out.layers[0].keys.find(k=>k.frame===10)!.shapes).toEqual([]);
 const { frames, poses } = out.sharedArtwork[0];
 expect(poses[frames[4]][0].x).toBe(80);expect(poses[frames[8]][0].x).toBe(160);expect(poses[frames[10]]).toEqual([]);expect(p).toEqual(before);
});
it('keeps original opacity channels and source scripts as unexecuted data',async()=>{
 const p=fixture();p.opacityBindings=[{layerId:p.layers[0].id,shapeId:'ink',start:0,end:8,keys:[{frame:0,opacity:.5},{frame:8,opacity:.5}]}];setFrameScript(p,0,"throw new Error('MUST_NOT_RUN');");const before=structuredClone(p),html=await exportRememberedHTML(p);
 expect(data(html).opacityChannels).toEqual([p.opacityBindings]);expect(p).toEqual(before);expect(html).toContain('requestAnimationFrame(draw)');
});
for(const mode of ['root','child','later']as const)it('rejects edited '+mode+' recipes without HTML publication',async()=>{
 const p=fixture();if(mode==='root')p.layers[0].keys[1].shapes[0].x++;else if(mode==='child')p.symbols![0].timeline!.keys[0].shapes[0].x++;
 else{const bad=structuredClone(p.symbols![0]);bad.id='bad';bad.timeline!.keys[0].shapes[0].x++;p.symbols!.push(bad);p.layers.push({id:'later',name:'Later',visible:true,locked:false,keys:[{frame:0,shapes:[]},{frame:8,shapes:[{...p.layers[1].keys[0].shapes[0],symbolId:bad.id}]}]});}
 const before=structuredClone(p);await expect(exportRememberedHTML(p)).rejects.toThrow('Generated keys changed');expect(p).toEqual(before);
});
for(const mode of ['root','child','opacity']as const)it('rejects nonfinite original '+mode+' values before JSON cloning',async()=>{
 const p=fixture();if(mode==='root')p.layers[0].keys[0].shapes[0].x=NaN;if(mode==='child')p.symbols![0].width=Infinity;if(mode==='opacity')p.layers[0].keys[0].shapes[0].opacity=NaN;await expect(exportRememberedHTML(p)).rejects.toThrow('Invalid project');
});
for(const mode of ['abort','source']as const)it('rejects pending preparation after '+mode,async()=>{
 const p=fixture(),controller=new AbortController();let current=true;const before=structuredClone(p),job=exportRememberedHTML(p,{signal:controller.signal,validate:()=>{if(!current)throw new Error('source changed');}});
 if(mode==='abort')controller.abort();else current=false;await expect(job).rejects.toThrow();expect(p).toEqual(before);
});
it('rejects late source changes during synchronous HTML compilation',async()=>{
 const p=fixture(),before=structuredClone(p),original=JSON.stringify;let current=true,compiled=false;
 try{
  JSON.stringify=((value:unknown,...args:unknown[])=>{const result=(original as (...args:unknown[])=>string)(value,...args);if((value as {clockPlan?:unknown})?.clockPlan){compiled=true;current=false;}return result;}) as typeof JSON.stringify;
  await expect(exportRememberedHTML(p,{validate:()=>{if(!current)throw new Error('source changed during compilation');}})).rejects.toThrow('source changed during compilation');expect(compiled).toBe(true);
 }finally{JSON.stringify=original;}expect(p).toEqual(before);
});
it('detaches the snapshot before yielding instead of compiling later caller mutations',async()=>{
 const p=fixture(),job=exportRememberedHTML(p);p.layers[0].keys[8].shapes[0].x=240;
 const out=data(await job);expect(out.layers[0].keys.find(k=>k.frame===4)!.shapes[0].x).toBe(80);expect(p.layers[0].keys[8].shapes[0].x).toBe(240);
});
