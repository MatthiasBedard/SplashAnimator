import {expect,it} from 'vitest';
import {newProject} from '../packages/document/src';
import {exportPresentationHTML} from '../packages/export-web/src';
it('rejects incomplete, invalid and excessive presentation traces before producing a renderer',()=>{
  const project=newProject();
  for(const poses of [[],[{frame:1,tick:0}],[{frame:0,tick:1}],[{frame:0,tick:0},{frame:0,tick:2}],
    [{frame:project.duration,tick:0}],Array.from({length:10002},(_,tick)=>({frame:0,tick}))])
    expect(()=>exportPresentationHTML(project,poses)).toThrow(/Presentation/);
  expect(exportPresentationHTML(project,[{frame:0,tick:0}])).toContain("c.dataset.tick");
});
it('defaults presentation buttons to Up without installing interaction handlers',()=>{
  const project=newProject();project.symbols=[{id:'button',name:'Button',width:10,height:10,shapes:[{id:'art',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#000000',stroke:'#000000',strokeWidth:0,points:[]}],
    timeline:{duration:2,keys:[{frame:1,shapes:[]}]},buttonStates:{up:0,over:0,down:0,hit:1}}];
  const html=exportPresentationHTML(project,[{frame:0,tick:0}]);
  expect(html).toContain("(c,p.buttons,p.width,p.height,false)");
  expect(html).toContain("c.splashButtonAt=(x,y)=>buttonRuntime.targetAt(x,y)");
});

it('validates and detaches optional presentation button states',()=>{
  const project=newProject();
  const state={instanceId:'instance',symbolId:'button',lifetime:1,state:'down' as const};
  for(const invalid of [{...state,lifetime:0},{...state,lifetime:Infinity},{...state,state:'up'},{...state,instanceId:3},null])
    expect(()=>exportPresentationHTML(project,[{frame:0,tick:0,buttonState:invalid as typeof state}])).toThrow(/Presentation button/);
  const poses=[{frame:0,tick:0},{frame:0,tick:1,buttonState:state}];
  const before=JSON.stringify(poses),html=exportPresentationHTML(project,poses);
  expect(JSON.stringify(poses)).toBe(before);
  state.lifetime=2;
  expect(html).toContain('"lifetime":1,"state":"down"');
});
