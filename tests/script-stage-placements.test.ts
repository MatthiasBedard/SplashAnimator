import { expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { captureStagePlacements, createInstanceLookup } from '../packages/scripting/src/stage-placements';
import { createScriptSession } from '../packages/scripting/src/session';
import type { ScriptState } from '../packages/scripting/src/timeline';
import { applyStagePresentation, createStageTransforms, placementTransformsKey, readPlacementTransforms } from '../packages/scripting/src/stage-transform';
import { createStageSpawns, readSpawnedGraphics, spawnedGraphicsKey } from '../packages/scripting/src/stage-spawn';
import {createScriptLibrary} from '../packages/scripting/src/stage-library';
import {createScriptSound,readScriptSound,scriptSoundKey,scriptSoundPosition,type SoundItem} from '../packages/scripting/src/stage-sound';
import {deepFixedButtonRoutes} from '../packages/scripting/src/stage-visibility';
import {exportScriptReplayHTML} from '../packages/export-web/src';

it('qualifies a deep fixed Button only at the selected pose and excludes a competing root path',()=>{
  const project=newProject(),layer=project.layers[0];
  const art:Vector={kind:'rectangle',id:'art',x:0,y:0,width:10,height:10,rotation:0,
    fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[]};
  const child=(id:string,symbolId:string):Vector=>({...art,kind:'symbol',id,symbolId,instanceName:id,
    symbolPlayback:{mode:'single',firstFrame:1}});
  const button={...child('button','button'),symbolPlayback:undefined};
  project.symbols=[
    {id:'button',name:'Button',width:10,height:10,shapes:[art],buttonStates:{up:0,over:0,down:0,hit:0},
      timeline:{duration:1,keys:[],frameScripts:[{frame:0,source:'state.hit=true;'}]}},
    {id:'middle',name:'Middle',width:10,height:10,shapes:[],timeline:{duration:2,keys:[{frame:1,shapes:[button]}]}},
    {id:'outer',name:'Outer',width:10,height:10,shapes:[child('middle','middle')]},
  ];
  const root={...child('outer','outer'),symbolPlayback:undefined},key={frame:0,shapes:[root]};
  const resolve=deepFixedButtonRoutes(project,project.layers);
  expect(resolve(layer,key)).toEqual([expect.objectContaining({
    id:'outer/middle/button',token:JSON.stringify([layer.id+'/0','outer/middle/button','button']),
  })]);
  expect(resolve(layer,{...key,shapes:[root,{...art,id:'outer/middle'}]})).toEqual([]);
  project.symbols[2].shapes[0].symbolPlayback={mode:'single',firstFrame:0};
  expect(deepFixedButtonRoutes(project,project.layers)(layer,key)).toEqual([]);
});

it('isolates ambiguous authored names by layer and rejects incompatible checkpoints', async()=>{
  const project=newProject(),base=project.layers[0];
  const instance:Vector={kind:'symbol',id:'one',instanceName:'__proto__',symbolId:'asset',x:0,y:0,
    rotation:0,width:10,height:10,fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[]};
  base.keys=[{frame:0,shapes:[instance]}];
  project.layers.push({...base,id:'hidden',visible:false,keys:[{frame:0,shapes:[{...instance,id:'two'}]}]});
  const capture=await captureStagePlacements(project.layers);
  const checkpoint=(table:typeof capture)=>createScriptSession({duration:2,fps:24,seed:0},[],{},'entry',undefined,
    {width:20,height:20,layerCount:2},table);
  const original=checkpoint(capture).checkpoint();
  expect((await captureStagePlacements(project.layers))?.identity).toBe(capture?.identity);
  instance.instanceName='new';
  const changed=await captureStagePlacements(project.layers);
  expect(()=>checkpoint(changed).restore(original)).toThrow();
  const lookup=createInstanceLookup(capture!.at(1));
  expect(()=>lookup('__proto__')).toThrow(/ambiguous/i);
  expect(lookup('__proto__','hidden')).toEqual({id:'two',name:'__proto__',symbolId:'asset',layerId:'hidden',visible:false});
  expect(Object.isFrozen(lookup('__proto__',base.id))).toBe(true);
  expect(lookup('new')).toBeUndefined();
  expect(()=>lookup(' ')).toThrow(/invalid/i);
});

it('hides only the resolved static exposure while preserving authored alpha and later keys',async()=>{
  const {applyStageVisibility,captureArtworkVisibility,createStageVisibility,hiddenPlacementKeys,hiddenPlacementsKey}=await import('../packages/scripting/src/stage-visibility');
  const p=newProject(),layer=p.layers[0];
  p.duration=4;
  const source:Vector={kind:'symbol',id:'one',instanceName:'Actor',symbolId:'asset',x:0,y:0,rotation:0,width:10,height:10,fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[],opacity:.36};
  p.symbols=[{id:'asset',name:'Graphic',width:10,height:10,shapes:[
    {kind:'rectangle',id:'paint',x:0,y:0,width:10,height:10,rotation:0,fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[]},
  ]}];
  layer.keys=[{frame:0,shapes:[source]},{frame:3,shapes:[{...source}]}];
  const original=structuredClone(p),table=await captureStagePlacements(p.layers,p),state={};
  const stage=createStageVisibility(createInstanceLookup(table!.at(1)),state,hiddenPlacementsKey,hiddenPlacementKeys);
  stage.setVisible('Actor',false);
  const keys=hiddenPlacementKeys(Reflect.get(state,hiddenPlacementsKey));
  expect(captureArtworkVisibility(p)(keys)).toEqual({graphics:keys,buttons:[]});
  expect(()=>captureArtworkVisibility(p)(['unowned'])).toThrow(/Unknown/);
  const replay=[{frame:0,tick:0},{frame:0,tick:1,hiddenGraphics:keys}];
  const html=exportScriptReplayHTML(p,replay);
  expect(html).toContain('"hiddenGraphics":[0]');
  expect(html).toContain('"visibilityOwner":0');
  expect(()=>exportScriptReplayHTML(p,[replay[0],{...replay[1],hiddenGraphics:['unowned']}])).toThrow(/Unknown replay Graphic/);
  expect(()=>exportScriptReplayHTML(p,[replay[0],{...replay[1],hiddenGraphics:[...keys,...keys]}])).toThrow(/Invalid replay Graphic/);
  const modified=applyStageVisibility(p,state);
  expect(modified.layers[0].keys.map(k=>k.shapes[0].opacity)).toEqual([0,.36]);
  expect(p).toEqual(original);
  expect(()=>applyStageVisibility(p,{[hiddenPlacementsKey]:['unowned']})).toThrow(/Unknown/);
  expect(()=>hiddenPlacementKeys(['x','x'])).toThrow();
  stage.setVisible('Actor',true);
  expect(applyStageVisibility(p,state)).toBe(p);
  p.symbols[0].timeline={duration:2,keys:[]};
  const animated=await captureStagePlacements(p.layers,p);
  createStageVisibility(createInstanceLookup(animated!.at(1)),state,hiddenPlacementsKey,hiddenPlacementKeys)
    .setVisible('Actor',false);
  expect(applyStageVisibility(p,state).layers[0].keys.map(k=>k.shapes[0].opacity)).toEqual([0,.36]);
  p.symbols[0].timeline.keys = [{frame:1,shapes:[{...source,id:'later-nested',instanceName:undefined}]}];
  const unsupported=await captureStagePlacements(p.layers,p);
  expect(()=>createStageVisibility(createInstanceLookup(unsupported!.at(1)),{},hiddenPlacementsKey,hiddenPlacementKeys)
    .setVisible('Actor',false)).toThrow(/noninteractive graphic/);
});

it('scopes a named child to its authored parent and exposure and rejects ambiguous ownership',async()=>{
  const {applyStageVisibility,captureButtonVisibility,createStageVisibility,hiddenPlacementKeys,hiddenPlacementsKey}=
    await import('../packages/scripting/src/stage-visibility');
  const p=newProject(),layer=p.layers[0];
  const child:Vector={kind:'symbol',id:'child',instanceName:'Action',symbolId:'button',x:0,y:0,
    rotation:0,width:10,height:10,fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[]};
  p.symbols=[
    {id:'button',name:'Button',width:10,height:10,shapes:[],buttonStates:{up:0,over:0,down:0,hit:0}},
    {id:'panel',name:'Panel',width:10,height:10,shapes:[child]},
  ];
  const parent:Vector={...child,id:'first',instanceName:'First',symbolId:'panel'};
  layer.keys=[{frame:0,shapes:[parent,{...parent,id:'second',instanceName:'Second'}]},{frame:2,shapes:[parent]}];
  const table=await captureStagePlacements(p.layers,p,true);
  const state={};
  const stage=createStageVisibility(createInstanceLookup(table!.at(1)),state,hiddenPlacementsKey,hiddenPlacementKeys);
  expect(stage.getInstance('Action')).toBeUndefined();
  expect(stage.getChildInstance('First','Action')).toMatchObject({id:'first/child',parentId:'first',visible:true});
  stage.setChildVisible('First','Action',false);
  expect(stage.getChildInstance('Second','Action')?.visible).toBe(true);
  const tokens=new Set<string>();
  applyStageVisibility(p,state,tokens);
  expect([...tokens]).toEqual([JSON.stringify([layer.id+'/0','first/child','button'])]);
  expect(captureButtonVisibility(p)(hiddenPlacementKeys(Reflect.get(state,hiddenPlacementsKey)))).toEqual([...tokens]);
  const later=createStageVisibility(createInstanceLookup(table!.at(2)),state,hiddenPlacementsKey,hiddenPlacementKeys);
  expect(later.getChildInstance('First','Action')?.visible).toBe(true);

  p.symbols[1].shapes.push({...child,id:'duplicate'});
  const duplicate=await captureStagePlacements(p.layers,p,true);
  expect(()=>createInstanceLookup(duplicate!.at(0))('Action',undefined,'First')).toThrow(/Ambiguous child/);
  p.symbols[1].shapes=[child];
  p.symbols[1].timeline={duration:3,keys:[{frame:1,shapes:[]},{frame:2,shapes:[child]}]};
  p.duration=5;
  layer.keys=[{frame:0,shapes:[parent]}];
  const animated=await captureStagePlacements(p.layers,p,true,p.duration);
  const at=(frame:number)=>createInstanceLookup(animated!.at(frame))('Action',undefined,'First');
  expect(at(0)?.id).toBe('first/child');
  expect(at(1)).toBeUndefined();
  expect(at(2)?.id).toBe('first/child');
  expect(at(2)?.visibilityKey).not.toBe(at(0)?.visibilityKey);
  const detachedSpans=animated!.animatedButtonSpans();
  expect(detachedSpans.some(span=>'animated:'+span.token===at(0)?.visibilityKey)).toBe(true);
  expect(detachedSpans.some(span=>'animated:'+span.token===at(2)?.visibilityKey)).toBe(true);
  Reflect.set(detachedSpans[0].placement,'id','foreign');
  detachedSpans.length=0;
  expect(at(0)?.id).toBe('first/child');
  expect(animated!.animatedButtonSpans().every(span=>span.placement.id==='first/child')).toBe(true);
  p.symbols[1].shapes=[];
  p.symbols[1].timeline={duration:3,keys:[],layers:[
    {id:'controls',name:'Controls',visible:true,locked:false,
      keys:[{frame:0,shapes:[]},{frame:1,shapes:[child]},{frame:2,shapes:[]}]},
    {id:'hidden',name:'Hidden',visible:false,locked:false,keys:[{frame:0,shapes:[child]}]},
  ]};
  const multilayer=await captureStagePlacements(p.layers,p,true,p.duration);
  expect(createInstanceLookup(multilayer!.at(0))('Action',undefined,'First')).toBeUndefined();
  expect(createInstanceLookup(multilayer!.at(1))('Action',undefined,'First')?.id).toBe('first/controls/child');
  const competingParent: Vector = {...parent,id:'first/controls',instanceName:'Other'};
  layer.keys[0].shapes.push(competingParent);
  const ambiguousPath=await captureStagePlacements(p.layers,p,true,p.duration);
  expect(createInstanceLookup(ambiguousPath!.at(1))('Action',undefined,'First')).toBeUndefined();
  layer.keys[0].shapes.pop();
  parent.symbolPlayback={mode:'single',firstFrame:1};
  const fixed=await captureStagePlacements(p.layers,p,true,p.duration);
  const fixedOwner=createInstanceLookup(fixed!.at(0))('Action',undefined,'First');
  expect(fixedOwner?.id).toBe('first/controls/child');
  expect(createInstanceLookup(fixed!.at(4))('Action',undefined,'First')).toEqual(fixedOwner);
  const fixedStage=createStageVisibility(createInstanceLookup(fixed!.at(0)),state,hiddenPlacementsKey,hiddenPlacementKeys);
  fixedStage.setChildVisible('First','Action',false);
  expect(captureButtonVisibility(p)(hiddenPlacementKeys(Reflect.get(state,hiddenPlacementsKey))))
    .toContain(JSON.stringify([layer.id+'/0','first/controls/child','button']));
  p.layerMasks=[{maskLayerId:'mask',layerIds:[layer.id]}];
  const masked=await captureStagePlacements(p.layers,p,true,p.duration);
  expect(createInstanceLookup(masked!.at(0))('Action',undefined,'First')).toBeUndefined();
});
it('bounds detached transforms to an authored root exposure and preserves its affine basis', async () => {
  const project = newProject();
  const layer = project.layers[0];
  const rect: Vector = {kind:'rectangle',id:'rect',x:0,y:0,rotation:0,width:10,height:10,
    fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[]};
  const root: Vector = {...rect,kind:'symbol',id:'graphic',symbolId:'asset',instanceName:'Actor',
    x:2,y:3,rotation:11,transform:[-1,0.1,0.2,1]};
  project.duration = 4;
  project.symbols = [{id:'asset',name:'Asset',width:10,height:10,shapes:[rect]}];
  layer.keys = [{frame:0,shapes:[root]}, {frame:2,shapes:[{...root,x:90}]}];
  const before = structuredClone(project);
  const capture = await captureStagePlacements(project.layers,project);
  const state: ScriptState = {};
  const api = (frame: number) => createStageTransforms(createInstanceLookup(capture!.at(frame)),state,placementTransformsKey,readPlacementTransforms);
  const old = api(0).getTransform('Actor');
  expect(old).toEqual({x:2,y:3,rotation:11});
  expect(Object.isFrozen(old)).toBe(true);
  api(0).setTransform('Actor',{x:40,y:-3,rotation:90});
  expect(api(1).getTransform('Actor')).toEqual({x:40,y:-3,rotation:90});
  expect(api(2).getTransform('Actor')).toEqual({x:90,y:3,rotation:11});
  const authoredBasis = api(0).getBasis('Actor');
  expect(authoredBasis).toEqual([-1,0.1,0.2,1]);
  expect(Object.isFrozen(authoredBasis)).toBe(true);
  const result = applyStagePresentation(project,state);
  expect(result.layers[0].keys[0].shapes[0]).toEqual({...root,x:40,y:-3,rotation:90});
  expect(result.layers[0].keys[1]).toEqual(before.layers[0].keys[1]);
  expect(project).toEqual(before);
  expect(() => api(0).setTransform('Actor',{x:100001,y:0,rotation:0})).toThrow(/bounded finite/);
  expect(() => api(0).setTransform('Missing',{x:0,y:0,rotation:0})).toThrow(/owned named graphic/);
  const accessor = ['target',1,2,3];
  const read = vi.fn(() => 1);
  Object.defineProperty(accessor,1,{get:read});
  expect(() => readPlacementTransforms([accessor])).toThrow(/transform entry/);
  expect(read).not.toHaveBeenCalled();
  expect(() => applyStagePresentation(project,{[placementTransformsKey]:[['forged',1,2,3]]})).toThrow(/Unknown/);
  const basis: [number,number,number,number] = [-2,0,0.5,0.75];
  api(1).setBasis('Actor',basis);
  basis[0] = -3;
  expect(api(0).getBasis('Actor')).toEqual([-2,0,0.5,0.75]);
  expect(api(2).getBasis('Actor')).toEqual(authoredBasis);
  expect(api(1).getTransform('Actor')).toEqual({x:40,y:-3,rotation:90});
  expect(applyStagePresentation(project,state).layers[0].keys[0].shapes[0].transform)
    .toEqual([-2,0,0.5,0.75]);
  const snapshot = structuredClone(state);
  expect(() => api(1).setBasis('Actor',[1,1,1,1])).toThrow(/nonsingular/);
  expect(() => api(1).setBasis('Actor',[1,0,0,1e-11])).toThrow(/nonsingular/);
  expect(() => api(1).setBasis('Actor',[1,0,0,Infinity])).toThrow(/finite/);
  expect(() => api(1).setBasis('Actor',[100001,0,0,1])).toThrow(/bounded/);
  expect(state).toEqual(snapshot);
  const guardedBasis: [number,number,number,number] = [1,0,0,1];
  Object.defineProperty(guardedBasis,0,{get:read});
  expect(() => api(1).setBasis('Actor',guardedBasis)).toThrow(/transform entry/);
  expect(read).not.toHaveBeenCalled();
  api(0).setTransform('Actor',old!);
  expect(api(0).getBasis('Actor')).toEqual([-2,0,0.5,0.75]);
  api(0).setBasis('Actor',authoredBasis!);
  expect(state).toEqual({});
});

it('admits detached static library graphics even when there are no named authored placements', async () => {
  const project = newProject(), layer = project.layers[0];
  const art:Vector={kind:'ellipse',id:'leaf',x:0,y:0,rotation:0,width:12,height:8,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  project.symbols=[
    {id:'asset',name:'Asset',width:12,height:8,shapes:[art]},
    {id:'disabled',name:'Disabled',width:12,height:8,shapes:[art],
      buttonStates:{up:0,over:0,down:0,hit:0}},
  ];
  layer.id='@script-graphics';
  const original=structuredClone(project);
  const table=await captureStagePlacements(project.layers,project);
  expect(table?.at(0)).toEqual([]);
  expect(table?.spawnable).toEqual(['asset']);
  const state:ScriptState={};
  const api=createStageSpawns(state,spawnedGraphicsKey,new Set(table?.spawnable),readSpawnedGraphics);
  expect(()=>api.spawnGraphic('Unauthorised','disabled',{x:2,y:3,rotation:0})).toThrow(/unavailable/);
  api.spawnGraphic('Echo','asset',{x:10,y:2,rotation:15});
  expect(api.getSpawned('Echo')).toEqual({name:'Echo',symbolId:'asset',x:10,y:2,rotation:15});
  expect(Object.isFrozen(api.getSpawned('Echo'))).toBe(true);
  expect(()=>api.spawnGraphic('Echo','asset',{x:0,y:0,rotation:0})).toThrow(/unique/);
  expect(()=>api.removeSpawned('Authored')).toThrow(/script-owned/);
  const result=applyStagePresentation(project,state);
  expect(result.layers.at(-1)).toMatchObject({id:'@script-graphics-',keys:[{frame:0,shapes:[{
    kind:'symbol',symbolId:'asset',x:10,y:2,rotation:15,width:12,height:8,
  }]}]});
  expect(project).toEqual(original);
  expect(()=>applyStagePresentation(project,{[spawnedGraphicsKey]:[['x','absent',0,0,0]]})).toThrow(/unavailable/);
  expect(()=>readSpawnedGraphics(Array.from({length:129},(_,i)=>['graphic'+i,'asset',0,0,0]),new Set(['asset'])))
    .toThrow(/128/);
  api.removeSpawned('Echo');
  expect(applyStagePresentation(project,state)).toBe(project);
});

it('resolves direct graphics by parent and their original frame clock without granting visibility writes', async () => {
  const project=newProject(),layer=project.layers[0];
  const graphic:Vector={kind:'symbol',id:'child',instanceName:'Tag',symbolId:'asset',
    x:0,y:0,width:10,height:10,rotation:0,fill:'#ffffff',stroke:'#000000',strokeWidth:0,points:[]};
  project.symbols=[
    {id:'asset',name:'Asset',width:10,height:10,shapes:[{...graphic,id:'art',kind:'rectangle',symbolId:undefined,instanceName:undefined}]},
    {id:'container',name:'Container',width:10,height:10,shapes:[],timeline:{duration:3,keys:[],layers:[
      {id:'details',name:'Details',visible:true,locked:false,keys:[
        {frame:0,shapes:[]},{frame:1,shapes:[graphic]},{frame:2,shapes:[]},
      ]},
    ]}},
  ];
  const root:Vector={...graphic,id:'first',instanceName:'First',symbolId:'container'};
  layer.keys=[{frame:0,shapes:[root,{...root,id:'second',instanceName:'Second',symbolPlayback:{mode:'single',firstFrame:1}}]},
    {frame:2,shapes:[root]}];
  project.duration=5;
  const table=await captureStagePlacements(project.layers,project,true,project.duration);
  const lookup=(frame:number)=>createInstanceLookup(table!.at(frame));
  expect(lookup(0)('Tag')).toBeUndefined();
  expect(lookup(0)('Tag',undefined,'First')).toBeUndefined();
  expect(lookup(0)('Tag',undefined,'Second')?.id).toBe('second/details/child');
  const current=lookup(1)('Tag',layer.id,'First');
  expect(current).toMatchObject({id:'first/details/child',symbolId:'asset',parentId:'first',visible:true});
  expect(Object.isFrozen(current)).toBe(true);
  expect(current?.visibilityKey).toBeUndefined();
  expect(lookup(2)('Tag',undefined,'First')).toBeUndefined();
  expect(lookup(2)('Tag',undefined,'Second')).toBeUndefined();
  expect(lookup(3)('Tag',undefined,'First')?.id).toBe('first/details/child');
  graphic.instanceName='Changed';
  const newer=await captureStagePlacements(project.layers,project,true,project.duration);
  expect(newer?.identity).not.toBe(table?.identity);
  expect(lookup(1)('Tag',undefined,'First')?.name).toBe('Tag');
});

it('binds sorted library metadata and link creation to the original capture', async () => {
  const project=newProject();
  const rect:Vector={kind:'rectangle',id:'leaf',x:0,y:0,rotation:0,width:12,height:8,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  project.symbols=[
    {id:'first',name:'First',width:12,height:8,shapes:[rect]},
    {id:'movie',name:'Movie',width:12,height:8,shapes:[rect],defaultPlayback:'movie'},
  ];
  project.assets=[
    {id:'image',path:'art/image.png',bitmap:{name:'Image',width:60,height:80,dataUrl:'private'}},
    {id:'sound',path:'audio/sound.wav',audio:{name:'Sound',format:'pcm16-wav',sampleRate:48000,channels:2,frames:480}},
  ];
  project.libraryLinks=[
    {kind:'symbol',id:'first',name:'art.Badge'},
    {kind:'symbol',id:'movie',name:'art.Movie'},
    {kind:'audio',id:'sound',name:'Sound'},
    {kind:'bitmap',id:'image',name:'Image'},
    {kind:'bitmap',id:'gone',name:'Missing'},
  ];
  const captured=await captureStagePlacements(project.layers,project);
  const spawn=vi.fn();
  const bitmap=vi.fn();
  const api=createScriptLibrary(captured!.scriptLibrary,spawn,bitmap);
  expect(api.get('Image')).toEqual({kind:'bitmap',link:'Image',id:'image',name:'Image',width:60,height:80,canSpawn:true});
  expect(api.get('Sound')).toEqual({kind:'audio',link:'Sound',id:'sound',name:'Sound',format:'pcm16-wav',sampleRate:48000,channels:2,frames:480});
  expect(api.get('Missing')).toBeUndefined();
  expect(api.get('art.badge')).toBeUndefined();
  expect(Object.isFrozen(api.get('art.Badge'))).toBe(true);
  expect(api.get('art.Movie')).toMatchObject({canSpawn:false,defaultPlayback:'movie'});
  const pose={x:1,y:2,rotation:3};
  expect(()=>api.spawnGraphic('art.Movie','instance',pose)).toThrow(/cannot create/);
  expect(()=>api.spawnGraphic('Image','instance',pose)).toThrow(/cannot create/);
  api.spawnGraphic('art.Badge','instance',pose);
  expect(spawn).toHaveBeenCalledExactlyOnceWith('instance','first',pose);
  api.spawnBitmap('Image','picture',pose);
  expect(bitmap).toHaveBeenCalledExactlyOnceWith('picture','image',pose);
  expect(()=>api.spawnBitmap('Sound','picture',pose)).toThrow(/cannot create/);
  const state:ScriptState={};
  const spawns=createStageSpawns(state,spawnedGraphicsKey,new Set(captured!.spawnable),readSpawnedGraphics,new Set(['image']));
  spawns.spawnBitmap('photo','image',pose);
  expect(spawns.getSpawned('photo')).toMatchObject({kind:'bitmap',assetId:'image',rotation:3});
  expect(()=>spawns.spawnGraphic('photo','first',pose)).toThrow(/unique/);
  const instance=applyStagePresentation(project,state).layers.at(-1)!.keys[0].shapes[0];
  expect(instance).toMatchObject({kind:'rectangle',width:60,height:80,rotation:3,bitmap:{assetId:'image',x:0,y:0,width:60,height:80}});
  expect(()=>spawns.spawnBitmap('else','sound',pose)).toThrow(/bitmap is unavailable/);
  expect(()=>readSpawnedGraphics(Array.from({length:129},(_,i)=>i%2===0
    ? ['pic'+i,'image',0,0,0,'bitmap'] : ['pic'+i,'first',0,0,0]),new Set(['first']),new Set(['image'])))
    .toThrow(/128/);
  project.libraryLinks[0].name='art.Renamed';
  project.assets[0].bitmap!.width=99;
  expect(api.get('Image')).toMatchObject({width:60});
  expect(api.get('art.Renamed')).toBeUndefined();
  const renamed=await captureStagePlacements(project.layers,project);
  expect(renamed?.identity).not.toBe(captured?.identity);
});

it('uses the captured creation frame for graphics and creation tick for movie-default symbols', async()=>{
  const project=newProject();
  project.duration=10;
  const art:Vector={kind:'rectangle',id:'red',x:0,y:0,width:12,height:8,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  project.symbols=[
    {id:'g',name:'Graphic',width:12,height:8,shapes:[art],timeline:{duration:3,keys:[]}},
    {id:'m',name:'Movie',width:12,height:8,shapes:[art],defaultPlayback:'movie',timeline:{duration:3,keys:[]}},
  ];
  project.libraryLinks=[{id:'g',kind:'symbol',name:'G'},{id:'m',kind:'symbol',name:'M'}];
  const original=structuredClone(project),table=await captureStagePlacements(project.layers,project);
  const state:ScriptState={};
  const spawns=createStageSpawns(state,spawnedGraphicsKey,new Set(),readSpawnedGraphics,new Set(),new Set(['g','m']),{tick:8,frame:3});
  const library=createScriptLibrary(table!.scriptLibrary,spawns.spawnGraphic,spawns.spawnBitmap,spawns.spawnTimeline);
  library.spawnGraphic('G','Graphic',{x:3,y:0,rotation:0});
  library.spawnGraphic('M','Movie',{x:30,y:0,rotation:0});
  const frames=(frame:number,tick:number)=>applyStagePresentation(project,state,undefined,{frame,tick})
    .layers.at(-1)!.keys[0].shapes.map(shape=>shape.symbolPlayback?.firstFrame);
  expect(frames(3,8)).toEqual([0,0]);
  expect(frames(3,9)).toEqual([0,1]);
  expect(frames(5,9)).toEqual([2,1]);
  expect(frames(2,10)).toEqual([0,2]);
  expect(()=>frames(3,7)).toThrow(/Invalid preview pose/);
  expect(project).toEqual(original);
});

it('validates sound offsets, gain and permissions before updating detached state',()=>{
  const asset:SoundItem={id:'tone',kind:'audio',link:'fx.Tone',name:'Tone',format:'pcm16-wav',sampleRate:8000,channels:1,frames:8000};
  const assets=new Map([['tone',asset]]),state:ScriptState={};
  const at=(tick:number)=>createScriptSound(state,scriptSoundKey,assets,tick,20,readScriptSound,scriptSoundPosition);
  at(4).play('fx.Tone',20,0.5);
  expect(at(5).positionSamples()).toBe(20);
  expect(at(6).positionSamples()).toBe(420);
  expect(at(40).positionSamples()).toBe(8000);
  const initial=structuredClone(state);
  expect(()=>at(7).play('fx.Tone',8000)).toThrow(/sample offset/);
  expect(()=>at(7).play('fx.Tone',0,1.5)).toThrow(/gain/);
  expect(()=>at(7).play('tone')).toThrow(/link is unavailable/);
  expect(()=>readScriptSound(state[scriptSoundKey],new Map())).toThrow(/unavailable/);
  expect(state).toEqual(initial);
  at(7).pause();
  expect(at(9).positionSamples()).toBe(820);
  at(9).seekSamples(1234);
  expect(at(12).positionSamples()).toBe(1234);
  const paused=structuredClone(state);
  expect(()=>at(12).seekSamples(1234.5)).toThrow(/sample offset/);
  expect(state).toEqual(paused);
  at(12).resume();
  expect(at(13).positionSamples()).toBe(1234);
  expect(at(14).positionSamples()).toBe(1634);
  at(14).seekSamples(8000);
  at(15).pause();
  at(16).resume();
  expect(at(17).positionSamples()).toBe(8000);
  at(17).stop();
  expect(at(18).positionSamples()).toBeUndefined();
  expect(()=>at(18).seekSamples(0)).toThrow(/Select a linked sound/);
});
