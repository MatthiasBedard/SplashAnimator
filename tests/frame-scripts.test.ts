import {expect,it} from 'vitest';
import {newProject,validateProject,migrateProject,setFrameScript,clone,History} from '../packages/document/src';
it('owns sorted TypeScript sources by absolute main frame with independent history',()=>{
  const project=newProject(),before=clone(project),history=new History();
  setFrameScript(project,5,'timeline.stop();');setFrameScript(project,0,'');
  expect(project.frameScripts).toEqual([{frame:0,source:''},{frame:5,source:'timeline.stop();'}]);
  expect(project.layers).toEqual(before.layers);
  history.record(before,'Edit frame source');
  const undone=history.undo(project)!;expect(undone.frameScripts).toBeUndefined();
  expect(history.redo(undone)).toEqual(project);
  const validated=validateProject(project);validated.frameScripts![0].source='detached';
  expect(project.frameScripts![0].source).toBe('');
  setFrameScript(project,0,null);setFrameScript(project,5,null);expect(project.frameScripts).toBeUndefined();
});
it('rejects malformed and over-budget scripts before mutation and retains original source',()=>{
  const project=newProject();setFrameScript(project,0,'é'.repeat(131072));const before=clone(project);
  for(const [frame,source] of [[-1,'x'],[48,'x'],[0.5,'x'],[1,'x'],[0,'é'.repeat(131073)]] as const){
    expect(()=>setFrameScript(project,frame,source)).toThrow();expect(project).toEqual(before);
  }
  for(const frameScripts of [[{frame:NaN,source:''}],[{frame:0,source:42}],[{frame:2,source:''},{frame:1,source:''}],
    [{frame:0,source:''},{frame:0,source:''}],[Object.assign([],{frame:0,source:''})],null])expect(()=>validateProject({...project,frameScripts})).toThrow();
  expect(()=>validateProject({...project,duration:1,frameScripts:[{frame:1,source:''}]})).toThrow();
});
it('upgrades schema 40 without inventing executable sources or mutating input',()=>{
  const project=newProject(),legacy={...project,schemaVersion:40};const before=clone(legacy);
  expect(migrateProject(legacy)).toEqual(project);expect(legacy).toEqual(before);
  expect(()=>migrateProject({...legacy,frameScripts:[{frame:0,source:'unversioned'}]})).toThrow(/schema 41/);
});

it('keeps main-frame source ownership outside short symbol timelines',()=>{
  const project=newProject();setFrameScript(project,40,'timeline.stop();');
  project.symbols=[{id:'symbol',name:'Short symbol',width:10,height:10,shapes:[{id:'shape',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:1,points:[]}],timeline:{duration:2,keys:[]}}];
  expect(validateProject(project).frameScripts).toEqual(project.frameScripts);
});
