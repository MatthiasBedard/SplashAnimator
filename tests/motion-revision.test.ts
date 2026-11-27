import { expect, it } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { createRevisionMotionSampler } from '../packages/animation/src/motion-revision';

function fixture() {
  const p = newProject(); p.duration = 10;
  const shape: Vector = {id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:1,points:[]};
  p.layers[0].keys = [{frame:0,shapes:[shape]},{frame:8,shapes:[{...shape,x:80}]}];
  createBasicMotionSpan(p,[p.layers[0].id],0,8,'linear');
  return p;
}
it('rebuilds on revisions, undo and project replacement with detached results', () => {
  const original = fixture(); let project = original, revision = 0;
  const ids = [project.layers[0].id];
  const adapter = createRevisionMotionSampler(() => ({project,revision}),ids,0,8);
  ids.length = 0;
  const first = adapter.sample(4); expect(first[0].shapes[0].x).toBe(40); first[0].shapes[0].x = 999;
  expect(adapter.sample(4)[0].shapes[0].x).toBe(40);
  project.layers[0].keys[8].shapes[0].x=160;revision++;
  expect(adapter.sample(4)[0].shapes[0].x).toBe(80);
  project=clone(original);project.layers[0].keys[8].shapes[0].x=240;
  expect(adapter.sample(4)[0].shapes[0].x).toBe(120);
  project.layers[0].keys[8].shapes[0].x=80;revision++;
  expect(adapter.sample(4)[0].shapes[0].x).toBe(40);
  adapter.dispose();adapter.dispose();expect(()=>adapter.sample(4)).toThrow(/disposed/);
});
it('discards old captures on edited interiors and later-track preparation failures', () => {
  const project=fixture(),a=project.layers[0],b=clone(a);b.id='second';project.layers.push(b);let revision=0;
  const adapter=createRevisionMotionSampler(()=>({project,revision}),[a.id,b.id],0,8);
  expect(adapter.sample(4)).toHaveLength(2);
  const before=clone(project);b.keys[3].shapes[0].x=999;revision++;
  expect(()=>adapter.sample(4)).toThrow(/Generated keys changed/);
  b.keys=clone(before.layers[1].keys);b.keys[8].shapes[0].x=NaN;revision++;
  const invalid=structuredClone(project);expect(()=>adapter.sample(4)).toThrow();expect(project).toEqual(invalid);
  b.keys=clone(before.layers[1].keys);revision++;expect(adapter.sample(4)).toHaveLength(2);expect(project).toEqual(before);
});
it('rejects source races and reader failures without returning stale artwork, then retries', () => {
  const project=fixture();let revision=0,reads=0,raceAt=2,fail=false;
  const adapter=createRevisionMotionSampler(()=>{if(fail)throw new Error('source unavailable');if(++reads===raceAt)revision++;return {project,revision}},[project.layers[0].id],0,8);
  expect(()=>adapter.sample(4)).toThrow(/during preparation/);
  raceAt=0;expect(adapter.sample(4)[0].shapes[0].x).toBe(40);
  raceAt=reads+2;expect(()=>adapter.sample(4)).toThrow(/during sampling/);
  fail=true;expect(()=>adapter.sample(4)).toThrow(/source unavailable/);
  fail=false;raceAt=0;expect(adapter.sample(4)[0].shapes[0].x).toBe(40);
});
it('supports explicit invalidation and validates revision/frame values', () => {
  const project=fixture();let revision=0;
  const adapter=createRevisionMotionSampler(()=>({project,revision}),[project.layers[0].id],0,8);
  expect(adapter.sample(4)[0].shapes[0].x).toBe(40);
  project.layers[0].keys[8].shapes[0].x=160;adapter.invalidate();expect(adapter.sample(4)[0].shapes[0].x).toBe(80);
  for(revision of [-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])expect(()=>adapter.sample(4)).toThrow(/revision/);
  revision=1;for(const frame of [-1,0.5,9,NaN])expect(()=>adapter.sample(frame)).toThrow();
  expect(adapter.sample(4)[0].shapes[0].x).toBe(80);
});

it('rejects reentrant sampling and invalidation or disposal inside the source reader', () => {
  for(const action of ['sample','invalidate','dispose'] as const){
    const project=fixture();let trigger=false;
    const adapter=createRevisionMotionSampler(()=>{
      if(trigger){trigger=false;if(action==='sample')adapter.sample(4);else adapter[action]();}
      return {project,revision:0};
    },[project.layers[0].id],0,8);
    expect(adapter.sample(4)[0].shapes[0].x).toBe(40);trigger=true;
    expect(()=>adapter.sample(4)).toThrow(action==='sample'?/reenter/:/invalidated/);
    if(action==='dispose')expect(()=>adapter.sample(4)).toThrow(/disposed/);
    else expect(adapter.sample(4)[0].shapes[0].x).toBe(40);
  }
});
