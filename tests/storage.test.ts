import {
  splitBasicMotionSpan,
  reverseBasicMotionSpan,
  refreshBasicMotionSpan,
  setBasicMotionSpanAutoRefresh,
  refreshChangedBasicMotionSpans,
  editSymbolBasicMotionSpan,
  createBasicMotionSpan, setRememberedRotationOrShearKey, setRememberedScaleKey, setRememberedColorKey, setRememberedIntervalTiming, setRememberedPositionTiming, setRememberedOpacityKey, setRememberedPositionKey,
} from '../packages/animation/src/motion-spans';
import {
  convertToSymbol,
  symbolInstance,
  makeSymbolUnique,
  replaceSymbolArtwork,
  updateSymbolArtwork,
  updateSymbolTimeline,
} from '../packages/geometry/src/symbols';
import { createFolder, assignFolder } from '../packages/animation/src/folders';
import { duplicateLayer, positionLayer, layerDisplay } from '../packages/animation/src/layers';
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { newProject, id, type Vector } from '../packages/document/src';
import {
  createDirectory,
  NodeDirectoryStore,
  duplicateDirectory,
} from '../packages/document/src/node-store';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';
import { prepareCreateLiveMotionSpans, captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import {symbolLayers,newLayer} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import {prepareMaskLayer,prepareMaskMember} from '../packages/document/src/mask-authoring';
const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'splash-test-'));
  roots.push(root);
  const project = path.join(root, 'Roundtrip.spl');
  await createDirectory(project);
  return { root, project, store: new NodeDirectoryStore(project) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
describe('real .spl directory persistence', () => {
  it('lists nested TypeScript files and protects changes made by another editor',async()=>{
    const {project,store}=await fixture(),file='scripts/game/player.ts';
    await store.commit(file,'export const hp=2;',null);
    const reopened=new NodeDirectoryStore(project);
    expect(await reopened.listScripts()).toEqual([file,'scripts/main.ts']);
    const original=await reopened.read(file);
    await reopened.commit(file,'export const hp=3;',original);
    await expect(store.commit(file,'stale',original)).rejects.toThrow('changed on disk');
    await expect(store.commit(file,'duplicate',null)).rejects.toThrow();
    for(const invalid of ['scripts/../outside.ts','scripts/con.ts','settings/config.ts','scripts/raw.json'])
      await expect(store.commit(invalid,'',null)).rejects.toThrow();
    expect(await reopened.read(file)).toBe('export const hp=3;');
  });
  it('roundtrips remembered position and opacity keys and regenerates it from changed endpoints',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture(),layer=p.layers[0];
    delete layer.liveMotionSpans;
    createBasicMotionSpan(p,[layer.id],0,8,'linear',{paint:true,strokeColor:true,affine:true});
    setRememberedRotationOrShearKey(p,[layer.id],0,8,'rotation',2,450);
    setRememberedRotationOrShearKey(p,[layer.id],0,8,'shear',4,1);
    setRememberedIntervalTiming(p,[layer.id],0,8,'shear',4,{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0});
    setRememberedScaleKey(p,[layer.id],0,8,'x',2,2);
    setRememberedColorKey(p,[layer.id],0,8,'stroke',4,'#0000ff');
    setRememberedColorKey(p,[layer.id],0,8,'fill',2,'#00ff00');
    setRememberedPositionKey(p,[layer.id],0,8,'x',4,90);
    setRememberedPositionKey(p,[layer.id],0,8,'y',2,-12);
    setRememberedOpacityKey(p,[layer.id],0,8,4,0);
    await saveProject(store,p,null);
    const loaded=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(loaded).toEqual(p);
    loaded.layers[0].keys[0].shapes[0].opacity=0.5;
    refreshBasicMotionSpan(loaded,[layer.id],0,8);
    expect(loaded.layers[0].keys[2].shapes[0]).toMatchObject({opacity:0.25,x:49,y:-12,fill:'#00ff00',rotation:450,transform:[2,0,0.125,1]});
  });
  it('reopens independently keyed symbol gradient colors and numeric positions and edits them again',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture(),l=p.layers[0];delete l.liveMotionSpans;
    for(const key of l.keys.slice(0,2)) key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:'#000000',opacity:0.5},{offset:1,color:'#ffffff'}]};
    const def={id:'local',name:'Local',width:160,height:100,shapes:structuredClone(l.keys[0].shapes),timeline:{duration:12,keys:structuredClone(l.keys.slice(1))}};
    const ids=symbolLayers(def).map(l=>l.id);
    let authored=editSymbolBasicMotionSpan(def,ids,0,8,'create','linear',[def],undefined,false,{paint:true});
    authored=editSymbolBasicMotionSpan(authored,ids,0,8,{property:0,frame:4,value:'#00ff00'});
    authored=editSymbolBasicMotionSpan(authored,ids,0,8,{property:'gradientStopEasing',stop:0,frame:4,value:'in'});
    authored=editSymbolBasicMotionSpan(authored,ids,0,8,{property:'xKeys',frame:4,value:54});
    authored=editSymbolBasicMotionSpan(authored,ids,0,8,{property:'xKeyEases',frame:4,value:'in'});
    p.symbols=[authored];await saveProject(store,p,null);
    const recovered=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(recovered).toEqual(p);
    const reopened=recovered.symbols![0],row=symbolLayers(reopened)[0].keys[4].shapes[0];
    expect(symbolLayers(reopened)[0].keys[2].shapes[0].gradient!.stops[0].color).toBe('#004000');
    const changed=editSymbolBasicMotionSpan(reopened,ids,0,8,{property:'xKeyEases',frame:4,value:'out'});
    expect(symbolLayers(reopened)[0].keys[2].shapes[0].x).toBe(19.5);
    expect(symbolLayers(changed)[0].keys[2].shapes[0].x).toBe(42.5);
    expect(row.x).toBe(54);expect(row.gradient!.stops[0]).toEqual({offset:0,color:'#00ff00',opacity:0.5});
    const invalid={property:'xKeys' as const,frame:4,value:99};
    Object.defineProperty(invalid,'value',{get(){throw Error('Getter invoked');}});
    expect(()=>editSymbolBasicMotionSpan(reopened,ids,0,8,invalid)).toThrow(/original property/);
    const removed=editSymbolBasicMotionSpan(reopened,ids,0,8,{property:0,frame:4,value:null});
    expect(symbolLayers(removed)[0].motionSpans![0].gradientColorTracks).toBeUndefined();
    expect(symbolLayers(removed)[0].keys[4].shapes[0].x).toBe(54);
  });
  it('roundtrips and refreshes a remembered matched gradient stop',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture(),l=p.layers[0];delete l.liveMotionSpans;
    for(const key of l.keys.slice(0,2)) key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:'#112233'},{offset:1,color:'#ffffff'}]};
    createBasicMotionSpan(p,[l.id],0,8,'linear',{paint:true});
    setRememberedColorKey(p,[l.id],0,8,1,4,'#008800');
    await saveProject(store,p,null);
    const recovered=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(recovered).toEqual(p);
    refreshBasicMotionSpan(recovered,[l.id],0,8);
    expect(recovered.layers[0].keys[4].shapes[0].gradient!.stops[1].color).toBe('#008800');
  });
  it('reopens remembered color curves, splits the artwork and removes the last fill key',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture(),ids=['track'],layer=p.layers[0];
    delete layer.liveMotionSpans;
    for(const k of layer.keys.slice(0,2)){k.shapes[0].fill='#000000';k.shapes[0].x=8;}
    createBasicMotionSpan(p,ids,0,8,'linear',{paint:true,strokeColor:true});
    setRememberedColorKey(p,ids,0,8,'fill',4,'#c00000');
    setRememberedColorKey(p,ids,0,8,'stroke',4,'#00c000');
    setRememberedIntervalTiming(p,ids,0,8,'fill',4,'in');
    setRememberedIntervalTiming(p,ids,0,8,'stroke',4,'out');
    await saveProject(store,p,null);
    const loaded=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(loaded).toEqual(p);
    splitBasicMotionSpan(loaded,ids,0,8,2,true);
    refreshBasicMotionSpan(loaded,ids,2,8);
    expect(loaded.layers[0].keys).toEqual(layer.keys);
    setRememberedColorKey(p,ids,0,8,'fill',4,null);
    expect(layer.motionSpans![0].fillKeyEases).toBeUndefined();
    expect(layer.keys[2].shapes[0]).toMatchObject({fill:'#000000',stroke:'#009000'});
  });
  it('reopens eased opacity and rotation keys and splits the remembered curve',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture(),ids=['track'];
    delete p.layers[0].liveMotionSpans;
    createBasicMotionSpan(p,ids,0,8,'linear');
    setRememberedOpacityKey(p,ids,0,8,4,0);
    setRememberedRotationOrShearKey(p,ids,0,8,'rotation',4,480);
    setRememberedIntervalTiming(p,ids,0,8,'opacity',4,'in');
    setRememberedIntervalTiming(p,ids,0,8,'rotation',4,{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0});
    await saveProject(store,p,null);
    const reopened=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(reopened).toEqual(p);
    expect(reopened.layers[0].keys[2].shapes[0].rotation).toBeCloseTo(60,10);
    expect(reopened.layers[0].keys[2].shapes[0].opacity).toBe(0.75);
    splitBasicMotionSpan(reopened,ids,0,8,2,true);
    refreshBasicMotionSpan(reopened,ids,2,8);
    for(const i of [2,3,4,5,6,7]){
      expect(reopened.layers[0].keys[i].shapes[0].rotation).toBeCloseTo(p.layers[0].keys[i].shapes[0].rotation,10);
      expect(reopened.layers[0].keys[i].shapes[0].opacity).toBeCloseTo(p.layers[0].keys[i].shapes[0].opacity!,10);
    }
  });
  it('reopens remembered position interval timing with its generated artwork',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture();
    delete p.layers[0].liveMotionSpans;
    createBasicMotionSpan(p,['track'],0,8,'linear');
    setRememberedPositionKey(p,['track'],0,8,'y',4,52);
    setRememberedPositionTiming(p,['track'],0,8,'y',4,'in');
    await saveProject(store,p,null);
    const recovered=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(recovered).toEqual(p);
    setRememberedPositionTiming(recovered,['track'],0,8,'y',4,'out');
    expect(recovered.layers[0].keys[2].shapes[0].y).toBe(42);
  });
  it('reopens independent live fill and stroke interval curves with sparse keys',async()=>{
    const {project,store}=await fixture();
    const p=liveSplitFixture((_project,span)=>{
      span.options={paint:true,strokeColor:true};
      span.fillColorKeys=[{offset:4,color:'#0000ff'}];
      span.fillKeyEases=[{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0},'linear'];
      span.strokeColorKeys=[{offset:4,color:'#00ff00'}];
      span.strokeKeyEases=['out','linear'];
    });
    await saveProject(store,p,null);
    const reopened=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(reopened).toEqual(p);
    expect(reopened.layers[0].keys.map(key=>key.frame)).toEqual([0,8,10]);
  });
  it('reopens independently eased live position intervals without baking sparse artwork',async()=>{
    const {project,store}=await fixture(),p=liveSplitFixture((_p,s)=>{
      s.xKeys=[{offset:4,value:72}];s.xKeyEases=[{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0},'out'];
    });
    await saveProject(store,p,null);
    const recovered=(await loadProject(new NodeDirectoryStore(project))).project;
    expect(recovered).toEqual(p);expect(recovered.layers[0].keys.map(k=>k.frame)).toEqual([0,8,10]);
  });
  it('roundtrips separate matched gradient stop keys in a physical project',async()=>{
    const {project,store}=await fixture();
    const source=liveSplitFixture((p,span)=>{
      span.options={paint:true};
      for(const key of p.layers[0].keys.slice(0,2)) key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:'#000000'},{offset:1,color:'#ffffff'}]};
      span.gradientColorTracks=[{stop:0,keys:[{offset:3,color:'#ff0000'}]},{stop:1,keys:[{offset:5,color:'#00ff88'}],eases:['in',{kind:'cubic',x1:0.3,y1:0,x2:0.7,y2:1}]}];
    });
    await saveProject(store,source,null);
    expect((await loadProject(new NodeDirectoryStore(project))).project).toEqual(source);
  });
  it('roundtrips independent shear, rotation, scale, opacity, position, solid fill and stroke keys in a sparse live span', async () => {
    const { project, store } = await fixture();
    const original = liveSplitFixture((_p,span) => {
      span.options = { paint:true, strokeColor:true, affine:true };
      span.shearKeys = [{offset:2,value:-1.5},{offset:4,value:0}];
      span.rotationKeys = [{offset:2,value:-450},{offset:7,value:720}];
      span.scaleXKeys = [{offset:3,value:2}];
      span.sxKeyEases=['in','out'];span.syKeyEases=['out','linear'];
      span.shearKeyEases=[{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0},'linear','out'];
      span.scaleYKeys = [{offset:5,value:0.5}];
      span.opacityKeys = [{offset:2,value:0},{offset:5,value:0.375}];
      span.xKeys = [{offset:2,value:-80.25}];
      span.yKeys = [{offset:6,value:42}];
      span.fillColorKeys = [{offset:3,color:'#Aa0088'}];
      span.strokeColorKeys = [{offset:5,color:'#00ff11'}];
    });
    await saveProject(store, original, null);
    expect((await loadProject(new NodeDirectoryStore(project))).project).toEqual(original);
  });
  it('roundtrips scene and symbol frame comments through a physical .spl directory', async () => {
    const { project, store } = await fixture();
    const p = newProject('Comments');
    p.duration = 8;
    p.frameComments = [{ frame: 2, text: 'Scene cue\nThen cut' }];
    p.symbols = [{
      id: 'clip', name: 'Clip', width: 12, height: 12,
      shapes: [{ id: 'art', kind: 'rectangle', x: 0, y: 0, width: 12, height: 12,
        rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] }],
      timeline: { duration: 4, keys: [], frameComments: [{ frame: 2, text: 'Local cue\nHold' }] },
    }];
    const saved = JSON.parse(await saveProject(store, p, null));
    expect(saved.document.frameComments).toEqual(p.frameComments);
    expect(saved.document.symbols[0].timeline.frameComments).toEqual(p.symbols[0].timeline?.frameComments);
    expect((await loadProject(new NodeDirectoryStore(project))).project).toEqual(p);
  });

  it.each([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  ])(
    'opens a schema-%i directory and upgrades on save without changing IDs or asset bytes',
    async (version) => {
      const { project, store } = await fixture();
      const p = newProject('Legacy drawing');
      p.assets.push({ id: id(), path: 'assets/images/legacy.bin' });
      const bytes = Buffer.from([0, 17, 255, 8]);
      await fs.writeFile(path.join(project, p.assets[0].path), bytes);
      const current = JSON.parse(await saveProject(store, p, null));
      current.schemaVersion = version;
      current.document.schemaVersion = version;
      const legacy = JSON.stringify(current);
      await fs.writeFile(path.join(project, 'project.json'), legacy);
      const opened = await loadProject(store);
      expect(opened.project).toEqual(p);
      expect(opened.manifest).toBe(legacy);
      const upgraded = JSON.parse(await saveProject(store, opened.project, opened.manifest));
      expect(upgraded.schemaVersion).toBe(59);
      expect(upgraded.document.id).toBe(p.id);
      expect((await loadProject(store)).project).toEqual(p);
      expect(await fs.readFile(path.join(project, p.assets[0].path))).toEqual(bytes);
    },
  );
  it('roundtrips editable vectors, timing and asset references through physical files', async () => {
    const { project, store } = await fixture();
    const p = newProject('Roundtrip');
    const shape: Vector = {
      id: id(),
      kind: 'path',
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      rotation: 15,
      fill: '#123456',
      stroke: '#abcdef',
      strokeWidth: 3,
      points: [
        { x: 0, y: 0, pressure: 0.1 },
        { x: 100, y: 60, pressure: 0.9 },
      ],
    };
    shape.gradient = {
      transform: [1, 0, 0.5, 0.5],
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: '#123456', opacity: 0 },
        { offset: 1, color: '#abcdef', opacity: 0.65 },
      ],
    };
    p.layers[0].keys[0].shapes.push(shape);
    p.layers[0].keys[0].shapes.push({
      ...shape,
      id: id(),
      kind: 'polygon',
      points: [],
      fillRule: 'evenodd',
      closed: true,
      contours: [
        [
          { x: 0, y: 0, out: { x: 25, y: -20 } },
          { x: 100, y: 0, in: { x: 75, y: -20 } },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        [
          { x: 20, y: 20, out: { x: 30, y: 10 } },
          { x: 60, y: 20 },
          { x: 60, y: 60 },
          { x: 20, y: 60 },
        ],
      ],
    });
    p.layers[0].keys[0].shapes.push({
      ...shape,
      id: id(),
      kind: 'text',
      points: [],
      text: {
        content: 'Gradient text',
        font: 'Arial',
        size: 24,
        bold: false,
        italic: false,
        align: 'left',
      },
    });
    p.layers[0].keys[0].shapes.push({
      ...shape,
      id: id(),
      kind: 'brush',
      brush: {
        pressure: true,
        minimum: 0.1,
        aspect: 1,
        tilt: false,
        angle: 0,
        response: 2,
        twist: true,
      },
    });
    p.assets.push({ id: id(), path: 'assets/images/retained.png' });
    const asset = Buffer.from([137, 80, 78, 71, 0, 255]);
    await fs.writeFile(path.join(project, p.assets[0].path), asset);
    const raw = await saveProject(store, p, null);
    expect((await fs.stat(project)).isDirectory()).toBe(true);
    const opened = await loadProject(new NodeDirectoryStore(project));
    expect(opened.project).toEqual(p);
    expect(opened.manifest).toBe(raw);
    expect(opened.missingAssets).toEqual([]);
    expect(await fs.readFile(path.join(project, p.assets[0].path))).toEqual(asset);
    expect(await fs.readdir(path.join(project, 'vectors'))).toHaveLength(1);
  });
  it('preserves the last commit after interrupted writes and detects concurrent saves', async () => {
    const { store } = await fixture();
    const p = newProject();
    const raw = await saveProject(store, p, null);
    p.name = 'Changed';
    const broken: DirectoryStore = {
      read: (p) => store.read(p),
      exists: (p) => store.exists(p),
      writeNew: async (p, c) => {
        if (p.startsWith('vectors/')) throw new Error('disk full');
        await store.writeNew(p, c);
      },
      commit: (p, c, e) => store.commit(p, c, e),
    };
    await expect(saveProject(broken, p, raw)).rejects.toThrow('disk full');
    expect((await loadProject(store)).project.name).toBe('Untitled');
    const current = await saveProject(store, p, raw);
    await expect(saveProject(store, newProject('Stale editor'), raw)).rejects.toThrow(
      'changed on disk',
    );
    expect((await loadProject(store)).manifest).toBe(current);
  });
  it('keeps recoverable snapshots separate from explicit saves and detects missing assets', async () => {
    const { store } = await fixture();
    const p = newProject();
    await saveProject(store, p, null);
    p.name = 'Recovered';
    p.assets.push({ id: id(), path: 'assets/audio/missing.wav' });
    await saveProject(store, p, null, true);
    expect((await loadProject(store)).project.name).toBe('Untitled');
    const recovery = await loadProject(store, true);
    expect(recovery.project.name).toBe('Recovered');
    expect(recovery.missingAssets).toEqual(['assets/audio/missing.wav']);
  });
  it('duplicates all assets and unknown files without touching or overwriting the original', async () => {
    const { root, project, store } = await fixture();
    await saveProject(store, newProject(), null);
    const bytes = Buffer.from([0, 1, 255, 254]);
    await fs.writeFile(path.join(project, 'assets/imported/original.bin'), bytes);
    const target = path.join(root, 'Copy.spl');
    await duplicateDirectory(project, target);
    expect(await fs.readFile(path.join(target, 'assets/imported/original.bin'))).toEqual(bytes);
    expect((await loadProject(new NodeDirectoryStore(target))).project).toEqual(
      (await loadProject(store)).project,
    );
    await expect(createDirectory(project)).rejects.toThrow();
  });
  it('rejects traversal, absolute paths, and symlink escapes', async () => {
    const { root, project, store } = await fixture();
    for (const p of [
      '../secret',
      '/etc/passwd',
      'C:/secret',
      'a\\b',
      'a//b',
      'assets/../../secret',
    ])
      await expect(store.read(p)).rejects.toThrow();
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(
      outside,
      path.join(project, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(store.writeNew('escape/leak.txt', 'no')).rejects.toThrow('Symbolic');
  });
});

it('persists immutable bitmap payloads outside manifests and detects missing/conflicting assets', async () => {
  const { project, store } = await fixture();
  const p = newProject();
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=';
  p.assets.push({
    id: 'bitmap',
    path: 'assets/bitmaps/bitmap.json',
    bitmap: { name: 'Pixel', width: 1, height: 1, dataUrl },
  });
  const manifest = await saveProject(store, p, null);
  expect(manifest).not.toContain('data:image');
  expect((await loadProject(store)).project).toEqual(p);
  p.layers[0].keys[0].shapes = [
    {
      id: 'text',
      kind: 'text',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      rotation: 0,
      points: [],
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
      text: {
        content: 'Bitmap text',
        wordSpacing: 12,
        direction: 'rtl',
        kerning: 'none',
        font: 'Arial',
        size: 24,
        bold: false,
        italic: false,
        align: 'left',
        runs: [{ start: 0, end: 1, style: { bold: true, color: '#00aa00' } }],
      },
      bitmap: {
        assetId: 'bitmap',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        transform: [1, 0.2, 0.3, 1],
      },
    },
  ];
  p.assets[0].bitmap!.name = 'Renamed';
  const next = await saveProject(store, p, manifest);
  expect((await loadProject(store)).project).toEqual(p);
  await fs.writeFile(path.join(project, p.assets[0].path), '{}');
  await expect(saveProject(store, p, next)).rejects.toThrow('conflict');
  expect(await store.read('project.json')).toBe(next);
  await fs.unlink(path.join(project, p.assets[0].path));
  const missing = await loadProject(store);
  expect(missing.missingAssets).toEqual([p.assets[0].path]);
  expect(missing.project.assets[0].bitmap!.dataUrl).toBeUndefined();
});

it('roundtrips styled text runs with gradient paint', async () => {
  const { store } = await fixture();
  const p = newProject();
  const s: Vector = {
    id: id(),
    kind: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    text: {
      content: 'abc אבג',
      font: 'Arial',
      size: 24,
      bold: false,
      italic: false,
      align: 'left',
      runs: [
        {
          start: 0,
          end: 3,
          style: {
            size: 48,
            bold: true,
            color: '#ff0000',
            letterSpacing: 4,
            wordSpacing: 12,
            kerning: 'none',
          },
        },
      ],
    },
  };
  p.layers[0].keys[0].shapes = [s];
  const manifest = await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  s.gradient = {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  };
  await saveProject(store, p, manifest);
  expect((await loadProject(store)).project).toEqual(p);
});

it('roundtrips duplicated and organized layers in a physical directory', async () => {
  const { store } = await fixture(),
    p = newProject();
  const copied = duplicateLayer(p, p.layers[0].id);
  positionLayer(p, copied, 'bottom');
  layerDisplay(p, copied, 'solo');
  layerDisplay(p, copied, 'lockOthers');
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});

it('roundtrips nested folders and membership without rewriting layer artwork', async () => {
  const { store } = await fixture(),
    p = newProject();
  const a = createFolder(p, 'Characters'),
    b = createFolder(p, 'Hero', a);
  assignFolder(p, p.layers[0].id, b);
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});

it('roundtrips shared symbol definitions and multiple instance references physically', async () => {
  const { store } = await fixture(),
    p = newProject();
  p.layers[0].keys[0].shapes = [
    {
      id: 'symbol-art',
      kind: 'rectangle',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  convertToSymbol(p, p.layers[0].id, 0, ['symbol-art'], 'Shared');
  p.layers[0].keys[0].shapes.push(symbolInstance(p.symbols![0], 100, 200));
  const instances = p.layers[0].keys[0].shapes;
  makeSymbolUnique(p, p.layers[0].id, 0, instances[0].id);
  instances.push({
    id: 'replacement',
    kind: 'ellipse',
    x: 300,
    y: 100,
    width: 60,
    height: 80,
    rotation: 0,
    fill: '#0000ff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  replaceSymbolArtwork(p, instances[1].symbolId!, p.layers[0].id, 0, ['replacement']);
  const artwork = structuredClone(p.symbols![0].shapes);
  artwork[0].x += 12;
  artwork[0].opacity = 0.6;
  updateSymbolArtwork(p, p.symbols![0].id, artwork);
  const animated = structuredClone(p.symbols![0]);
  animated.timeline = {
    duration: 6,
    keys: [
      { frame: 2, shapes: structuredClone(artwork) },
      { frame: 5, shapes: [] },
    ],
  };
  updateSymbolTimeline(p, animated.id, animated);
  instances[1].symbolPlayback = { mode: 'movie', firstFrame: 2 };
  // Persist an independent movie referenced only from a later symbol key.
  const other = p.symbols!.find((d) => d.id !== animated.id)!;
  const nestedMovie = symbolInstance(other, 12, 8);
  nestedMovie.symbolPlayback = { mode: 'movie', firstFrame: 1 };
  animated.timeline!.keys[0].shapes.push(nestedMovie);
  updateSymbolTimeline(p, animated.id, animated);
  p.symbols![0].timeline!.layers = [
    {
      id: 'extra',
      name: 'Extra',
      visible: false,
      locked: true,
      keys: [
        { frame: 0, shapes: [] },
        { frame: 1, shapes: [symbolInstance(other, 20, 10)] },
      ],
    },
  ];
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});

it('persists button state mappings in current-schema physical files and rejects invalid saves', async () => {
  const { store } = await fixture();
  const p = newProject();
  p.symbols = [
    {
      id: 'button',
      name: 'Button',
      width: 10,
      height: 10,
      shapes: [
        {
          id: 'art',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
      timeline: { duration: 5, keys: [] },
      buttonStates: { up: 4, over: 1, down: 1, hit: 3 },
    },
  ];
  const manifest = await saveProject(store, p, null);
  expect(JSON.parse(manifest).schemaVersion).toBe(59);
  expect((await loadProject(store)).project).toEqual(p);
  for (const value of [-1, 5, 1.5, NaN]) {
    p.symbols[0].buttonStates!.hit = value;
    await expect(saveProject(store, p, manifest)).rejects.toThrow('button state frame');
    expect((await loadProject(store)).manifest).toBe(manifest);
  }
  p.symbols[0].buttonStates!.hit = 3;
  const candidate = structuredClone(p.symbols[0]);
  candidate.buttonStates = undefined;
  updateSymbolTimeline(p, 'button', candidate);
  expect(p.symbols[0].buttonStates).toBeUndefined();
  await saveProject(store, p, manifest);
  expect((await loadProject(store)).project.symbols![0].buttonStates).toBeUndefined();
});

it('physically roundtrips independent project and symbol pivots through save and autosave', async () => {
  const { store } = await fixture();
  const p = newProject();
  p.multiFramePivot = { x: -32.25, y: 560 };
  p.symbols = [
    {
      id: 's',
      name: 'S',
      width: 100,
      height: 100,
      multiFramePivot: { x: 11, y: -8 },
      shapes: [
        {
          id: 'a',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
  ];
  const manifest = await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  await saveProject(store, p, null, true);
  expect((await loadProject(store, true)).project).toEqual(p);
  delete p.multiFramePivot;
  delete p.symbols[0].multiFramePivot;
  await saveProject(store, p, manifest);
  expect((await loadProject(store)).project).toEqual(p);
});

it('roundtrips a remembered motion span and refreshes it after reopening the directory', async () => {
  const { store } = await fixture();
  const p = newProject();
  const shape: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['pair'],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape, { ...shape, id: 'member', x: 20 }] },
    {
      frame: 4,
      shapes: [
        { ...shape, x: 80 },
        { ...shape, id: 'member', x: 100 },
      ],
    },
  ];
  const symbol = {
    id: 'remembered-symbol',
    name: 'Remembered',
    width: 100,
    height: 100,
    shapes: [shape, { ...shape, id: 'member', x: 20 }],
    timeline: {
      duration: 6,
      keys: [
        {
          frame: 4,
          shapes: [
            { ...shape, x: 80 },
            { ...shape, id: 'member', x: 100 },
          ],
        },
      ],
      layers: [{ ...p.layers[0], id: 'extra' }],
    },
  };
  p.symbols = [
    editSymbolBasicMotionSpan(
      symbol,
      ['@base', 'extra'],
      0,
      4,
      'create',
      { kind: 'cubic', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
      [symbol],
      undefined,
      false,
      { paint: true, affine: true },
      { startX: 0, startY: 40, endX: 0, endY: 40 },
      {
        direction: 'clockwise',
        turns: 1,
        rigidGroups: true,
        groupDepth: 0,
        uniformGroupScale: true,
      },
    ),
  ];
  createBasicMotionSpan(
    p,
    [p.layers[0].id],
    0,
    4,
    { kind: 'cubic', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
    { paint: true, affine: true },
    { startX: 0, startY: 40, endX: 0, endY: 40 },
    { direction: 'clockwise', turns: 1, rigidGroups: true, groupDepth: 0, uniformGroupScale: true },
  );
  setBasicMotionSpanAutoRefresh(p, [p.layers[0].id], 0, 4, true);
  p.symbols![0] = editSymbolBasicMotionSpan(
    p.symbols![0],
    ['@base', 'extra'],
    0,
    4,
    'live',
    'linear',
    p.symbols,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    true,
  );
  await saveProject(store, p, null);
  const loaded = await loadProject(store);
  expect(loaded.project).toEqual(p);
  const before = structuredClone(loaded.project);
  loaded.project.layers[0].keys[4].shapes.forEach((s) => (s.x += 80));
  refreshChangedBasicMotionSpans(before, loaded.project, true);
  expect(loaded.project.layers[0].keys[2].shapes[0].x).toBe(80);
  await saveProject(store, loaded.project, loaded.manifest);
  expect((await loadProject(store)).project).toEqual(loaded.project);
});

it('physically retains all stored topology guards', async () => {
  const { store } = await fixture(),
    p = newProject();
  const shape: Vector = {
    id: 'guarded',
    kind: 'bezier',
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 10, y: 10 } },
      { x: 30, y: 0, in: { x: 20, y: 10 } },
    ],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape] },
    { frame: 4, shapes: [{ ...shape, x: 80 }] },
  ];
  createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear', {
    nodes: true,
    contourAreas: true,
    contourEdges: true,
    contourContacts: true,
    curveTangents: true,
    curveSelfContacts: true,
  });
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});
it('physically retains saved gradient resampling and opacity weighting', async () => {
  const { store } = await fixture(),
    p = newProject();
  const shape: Vector = {
    id: 'gradient',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    gradient: {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
      stops: [
        { offset: 0, color: '#ff0000', opacity: 0 },
        { offset: 1, color: '#ff0000', opacity: 0 },
      ],
    },
  };
  const target = structuredClone(shape);
  target.gradient!.stops = [0, 0.5, 1].map((offset) => ({ offset, color: '#0000ff', opacity: 1 }));
  p.layers[0].keys = [
    { frame: 0, shapes: [shape] },
    { frame: 4, shapes: [target] },
  ];
  createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear', {
    paint: true,
    gradientStops: true,
    gradientPremultiplied: true,
  });
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});

it.each(['ordered', 'explicit', 'auto'] as const)(
  'physically retains %s gradient correspondence',
  async (mode) => {
    const { store } = await fixture(),
      p = newProject();
    const shape: Vector = {
      id: 'gradient',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      gradient: {
        kind: 'linear',
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        stops: [
          { offset: 0, color: '#ff0000', opacity: 0 },
          { offset: 1, color: '#ff0000', opacity: 0 },
        ],
      },
    };
    const target = structuredClone(shape);
    target.gradient!.stops = [0, 0.5, 1].map((offset) => ({
      offset,
      color: '#0000ff',
      opacity: 1,
    }));
    if (mode === 'ordered')
      shape.gradient!.stops.splice(1, 0, { offset: 0.2, color: '#ff0000', opacity: 0 });
    p.layers[0].keys = [
      { frame: 0, shapes: [shape] },
      { frame: 4, shapes: [target] },
    ];
    createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear', {
      paint: true,
      gradientStops:
        mode === 'ordered'
          ? 'ordered'
          : {
              pairs:
                mode === 'auto'
                  ? 'auto'
                  : [
                      [0, 0],
                      [0, 1],
                      [1, 2],
                    ],
            },
      gradientGeometry: true,
      gradientPremultiplied: true,
    });
    await saveProject(store, p, null);
    expect((await loadProject(store)).project).toEqual(p);
  },
);
it('physically retains main and symbol base/additional contour correspondence', async () => {
  const { store } = await fixture(),
    p = newProject();
  const a: Vector = {
    id: 'contour',
    kind: 'bezier',
    closed: true,
    x: 0,
    y: 0,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 0, y: 60 },
    ],
  };
  const b = structuredClone(a);
  b.nodes = [b.nodes![2], b.nodes![0], b.nodes![1]];
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  p.symbols = [
    {
      id: 'contour',
      name: 'Contour',
      width: 100,
      height: 100,
      shapes: [a],
      timeline: {
        duration: 5,
        keys: [{ frame: 4, shapes: [b] }],
        layers: [
          {
            id: 'extra',
            name: 'Extra',
            visible: true,
            locked: false,
            keys: structuredClone(p.layers[0].keys),
          },
        ],
      },
    },
  ];
  const correspondence = { start: [1], reverse: [false], order: [0] };
  createBasicMotionSpan(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    { nodes: true },
    undefined,
    undefined,
    correspondence,
  );
  p.symbols[0] = editSymbolBasicMotionSpan(
    p.symbols[0],
    ['@base', 'extra'],
    0,
    4,
    'create',
    'linear',
    p.symbols,
    undefined,
    false,
    { nodes: true },
    undefined,
    undefined,
    false,
    correspondence,
  );
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});

it('physically retains main and symbol base/additional node hints and curved distance correspondence', async () => {
  const { store } = await fixture(),
    p = newProject();
  const a: Vector = {
    id: 'contour',
    kind: 'bezier',
    closed: true,
    x: 0,
    y: 0,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 0, y: 60 },
    ],
  };
  const b = structuredClone(a);
  b.nodes = [b.nodes![2], b.nodes![0], b.nodes![1]];
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  p.symbols = [
    {
      id: 'contour',
      name: 'Contour',
      width: 100,
      height: 100,
      shapes: [a],
      timeline: {
        duration: 5,
        keys: [{ frame: 4, shapes: [b] }],
        layers: [
          {
            id: 'extra',
            name: 'Extra',
            visible: true,
            locked: false,
            keys: structuredClone(p.layers[0].keys),
          },
        ],
      },
    },
  ];
  const correspondence = {
    start: [1],
    reverse: [false],
    order: [0],
    nodes: { curves: true, distance: true, hints: [[[1, 1] as [number, number]]] },
  };
  createBasicMotionSpan(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    { nodes: true },
    undefined,
    undefined,
    correspondence,
  );
  p.symbols[0] = editSymbolBasicMotionSpan(
    p.symbols[0],
    ['@base', 'extra'],
    0,
    4,
    'create',
    'linear',
    p.symbols,
    undefined,
    false,
    { nodes: true },
    undefined,
    undefined,
    false,
    correspondence,
  );
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
});


it('roundtrips main-frame TypeScript bodies through save, recovery and Save As without executing',async()=>{
  const {store,root,project:folder}=await fixture();
  const project=newProject('Sources');
  project.frameScripts=[{frame:0,source:'throw new Error("never execute on load");'},{frame:4,source:'// Unicode: é 漢字\ntimeline.stop();'}];
  await saveProject(store,project,null);
  expect((await loadProject(store)).project).toEqual(project);
  project.frameScripts[0].source='state.n = 2;';
  await saveProject(store,project,null,true);
  expect((await loadProject(store,true)).project).toEqual(project);
  expect((await loadProject(store)).project.frameScripts![0].source).toContain('never execute');
  const destination=path.join(root,'Copied.spl');await duplicateDirectory(folder,destination);
  expect((await loadProject(new NodeDirectoryStore(destination))).project.frameScripts![1]).toEqual(project.frameScripts[1]);
});

it('roundtrips schema 42 audio references while preserving external WAV bytes and missing reports',async()=>{
 const {project,store}=await fixture(),p=newProject();
 p.assets=[{id:'audio',path:'assets/audio/test.wav',audio:{name:'Test',format:'pcm16-wav',sampleRate:8000,channels:1,frames:2}}];
 p.audioClips=[{id:'clip',assetId:'audio',startFrame:2,offsetSamples:1,gain:0.5}];
 const manifest=await saveProject(store,p,null);expect((await loadProject(store)).missingAssets).toContain('assets/audio/test.wav');
 await fs.mkdir(path.join(project,'assets/audio'),{recursive:true});const bytes=Buffer.from((await import('./wav-fixture')).pcm16WavFixture([[0,16384]]));await fs.writeFile(path.join(project,'assets/audio/test.wav'),bytes);
 const loaded=await loadProject(store);expect(loaded.project).toEqual(p);expect(loaded.missingAssets).toEqual([]);
 await saveProject(store,loaded.project,manifest);expect(await fs.readFile(path.join(project,'assets/audio/test.wav'))).toEqual(bytes);
});

it.each([false,true])('physically roundtrips heading corrections linear %s on root and isolated symbol tracks',async(linear)=>{
 const {store}=await fixture(),p=newProject();p.duration=5;
 const art:Vector={id:'art',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 p.layers[0].keys=[{frame:0,shapes:[art]},{frame:4,shapes:[{...art,x:100}]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',undefined,{startX:30,startY:20,endX:-30,endY:20,tangent:true,headingOffset:180,...(linear?{headingOffsetEnd:90}:{})});
 const layer=structuredClone(p.layers[0]);p.symbols=[{id:'symbol',name:'Corrected',width:100,height:100,shapes:structuredClone(layer.keys[0].shapes),timeline:{duration:5,keys:structuredClone(layer.keys.slice(1)),motionSpans:structuredClone(layer.motionSpans),layers:[{...layer,id:'extra'}]}}];
 await saveProject(store,p,null);expect((await loadProject(store)).project).toEqual(p);
});

it('physically roundtrips schema 46 source alignment on root and symbol tracks',async()=>{
 const {store}=await fixture(),p=newProject();p.duration=5;
 const art:Vector={id:'a',kind:'polygon',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],contours:[[{x:0,y:0},{x:20,y:0},{x:0,y:20}]]};
 p.layers[0].keys=[{frame:0,shapes:[art]},{frame:4,shapes:[{...structuredClone(art),x:50}]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',{nodes:true},undefined,undefined,{source:{start:1,reverse:true},start:1,reverse:true});
 const layer=structuredClone(p.layers[0]);p.symbols=[{id:'s',name:'s',width:100,height:100,shapes:layer.keys[0].shapes,timeline:{duration:5,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[{...structuredClone(layer),id:'extra'}]}}];
 const manifest=await saveProject(store,p,null);expect(JSON.parse(manifest).schemaVersion).toBe(59);expect((await loadProject(store)).project).toEqual(p);
 p.symbols[0].timeline!.layers![0].motionSpans![0].correspondence!.source!.start=NaN;
 await expect(saveProject(store,p,manifest)).rejects.toThrow(/offset/);expect((await loadProject(store)).manifest).toBe(manifest);
});

it('physically roundtrips root opacity channels and preserves the committed manifest on invalid save',async()=>{
 const {project:dir,store}=await fixture(),p=newProject();p.duration=10;
 const art:Vector={id:'art',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 p.layers[0].keys=[{frame:0,shapes:[art]},{frame:7,shapes:[]}];
 p.symbols=[{id:'unused',name:'Unused',width:10,height:10,shapes:[art]}];
 p.opacityBindings=[{layerId:p.layers[0].id,shapeId:'art',start:1,end:6,keys:[{frame:1,opacity:0,ease:{kind:'cubic',x1:0,y1:1,x2:1,y2:0}},{frame:4,opacity:0.5,ease:'hold'},{frame:6,opacity:1}]}];
 const raw=await saveProject(store,p,null);expect((await loadProject(store)).project).toEqual(p);expect(JSON.parse(raw).document.opacityBindings).toEqual(p.opacityBindings);
 const before=await fs.readdir(path.join(dir,'vectors'));
 for(const mode of ['nan','gap','overlap','missing','sparse','badcurve']){
  const bad=structuredClone(p),bind=bad.opacityBindings![0],keys=bind.keys as {frame:number;opacity:number;ease?:unknown}[];
  if(mode==='nan')keys[0].opacity=NaN;if(mode==='gap')bind.end=7;if(mode==='overlap')bad.opacityBindings!.push(structuredClone(bind));if(mode==='missing')bind.shapeId='absent';if(mode==='sparse')delete keys[1];if(mode==='badcurve')keys[0].ease={kind:'cubic',x1:Infinity,x2:0,y1:0,y2:0};
  await expect(saveProject(store,bad,raw)).rejects.toThrow();
 }
 expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(before);expect((await loadProject(store)).manifest).toBe(raw);
 for(const [manifestVersion,documentVersion] of [[46,46],[46,47],[47,46]]){
  const invalid=JSON.parse(raw);invalid.schemaVersion=manifestVersion;invalid.document.schemaVersion=documentVersion;
  await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(invalid));await expect(loadProject(store)).rejects.toThrow(/schema 47/);
 }
});

it('roundtrips a distance-timed tangent split and refreshes its nonzero cut heading', async () => {
 const {project:dir,store}=await fixture(),p=newProject(),layer=p.layers[0];
 p.duration=9;
 const art:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 layer.keys=[{frame:0,shapes:[art]},{frame:8,shapes:[{...art,y:96}]}];
 const settings={startX:-32,startY:32,endX:-32,endY:-32,distance:true,tangent:true,headingOffset:10,headingOffsetEnd:30};
 createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,settings);
 const original=structuredClone(layer.keys);
 splitBasicMotionSpan(p,[layer.id],0,8,4,true);
 expect(layer.keys).toEqual(original);
 expect(layer.motionSpans!.every(s=>s.path?.distance && s.path.headingOffsetEnd!==undefined)).toBe(true);
 const manifest=await saveProject(store,p,null), reopened=(await loadProject(store)).project;
 expect(reopened).toEqual(p);
 for(const span of reopened.layers[0].motionSpans!)refreshBasicMotionSpan(reopened,[layer.id],span.start,span.end);
 for(const [i,k] of reopened.layers[0].keys.entries())for(const f of ['x','y','rotation'] as const)
   expect(k.shapes[0][f]).toBeCloseTo(original[i].shapes[0][f],10);
 const files=await fs.readdir(path.join(dir,'vectors'));
 for(const value of [Infinity,NaN,360001]){
   const invalid=structuredClone(p);
   invalid.layers[0].motionSpans![1].path!.headingOffsetEnd=value;
   await expect(saveProject(store,invalid,manifest)).rejects.toThrow(/correction/);
 }
 expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(files);
 expect((await loadProject(store)).manifest).toBe(manifest);
 for(const [outer,inner] of [[47,48],[48,47],[47,47]]){
   const old=JSON.parse(manifest);old.schemaVersion=outer;old.document.schemaVersion=inner;
   await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(old));
   await expect(loadProject(store)).rejects.toThrow(/schema 48/i);
 }
});

it('roundtrips reversed straight waypoint heading corrections and rejects a downgraded directory', async () => {
  const {project:dir,store}=await fixture(),p=newProject(),layer=p.layers[0];
  p.duration=7;
  const shape:Vector={id:'ink',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[shape]},{frame:4,shapes:[{...shape,x:100}]}];
  createBasicMotionSpan(p,[layer.id],0,4,'in',undefined,{startX:0,startY:0,endX:0,endY:0,
    distance:true,tangent:true,waypoints:[{x:20,y:15}],headingOffset:10,headingOffsetEnd:30});
  const before=structuredClone(layer.keys);
  reverseBasicMotionSpan(p,[layer.id],0,4);
  for (const key of before) expect(layer.keys[4-key.frame].shapes).toEqual(key.shapes);
  const raw=await saveProject(store,p,null), reopened=(await loadProject(store)).project;
  expect(reopened).toEqual(p);
  refreshBasicMotionSpan(reopened,[layer.id],0,4);
  for (const key of before) for(const field of ['x','y','rotation'] as const)
    expect(reopened.layers[0].keys[4-key.frame].shapes[0][field]).toBeCloseTo(key.shapes[0][field],10);
  const revisions=await fs.readdir(path.join(dir,'vectors'));
  for(const bad of [NaN,Infinity,360001]){
    const candidate=structuredClone(p);
    candidate.layers[0].motionSpans![0].path!.headingOffsetEnd=bad;
    await expect(saveProject(store,candidate,raw)).rejects.toThrow(/correction/);
  }
  expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(revisions);
  expect((await loadProject(store)).manifest).toBe(raw);
  for(const [outer,inner] of [[48,48],[49,48],[48,49]]){
    const old=JSON.parse(raw);old.schemaVersion=outer;old.document.schemaVersion=inner;
    await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(old));
    await expect(loadProject(store)).rejects.toThrow(/schema 49/i);
  }
});

it.each([3,4,6])('roundtrips curved waypoint split corrections and rejects invalid or downgraded writes at %i',async(at)=>{
  const {project:dir,store}=await fixture(),p=newProject(),layer=p.layers[0];p.duration=14;
  const art:Vector={id:'curve',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:90,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[art]},{frame:12,shapes:[{...art,x:90,y:40,rotation:150}]},{frame:13,shapes:[]}];
  createBasicMotionSpan(p,[layer.id],0,12,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,
    curvedWaypoints:true,waypoints:[{x:30,y:30},{x:60,y:10}],tangent:true,headingOffset:10,headingOffsetEnd:30});
  const original=structuredClone(layer.keys);
  splitBasicMotionSpan(p,[layer.id],0,12,at,true);expect(layer.keys).toEqual(original);
  const raw=await saveProject(store,p,null),loaded=(await loadProject(store)).project;
  expect(JSON.parse(raw).schemaVersion).toBe(59);expect(loaded).toEqual(p);
  for(const span of loaded.layers[0].motionSpans!)refreshBasicMotionSpan(loaded,[layer.id],span.start,span.end);
  for(let i=0;i<=12;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(original[i].shapes[0][field],10);
  const revisions=await fs.readdir(path.join(dir,'vectors'));
  for(const bad of [NaN,Infinity,360001]){
    const candidate=structuredClone(p);candidate.layers[0].motionSpans![1].path!.headingOffsetEnd=bad;
    await expect(saveProject(store,candidate,raw)).rejects.toThrow(/correction/);
  }
  expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(revisions);
  expect((await loadProject(store)).manifest).toBe(raw);
  for(const [outer,inner] of [[49,49],[50,49],[49,50]]){
    const old=JSON.parse(raw);old.schemaVersion=outer;old.document.schemaVersion=inner;
    await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(old));
    await expect(loadProject(store)).rejects.toThrow(/schema 50/i);
  }
});

it('physically roundtrips reversed equal-time curved tangent recipes without changing keys',async()=>{
  const {project:dir,store}=await fixture(),p=newProject(),layer=p.layers[0];p.duration=14;
  const art:Vector={id:'reverse-curve',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:90,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[art]},{frame:12,shapes:[{...art,x:90,y:40,rotation:150}]},{frame:13,shapes:[]}];
  createBasicMotionSpan(p,[layer.id],0,12,'in',undefined,{startX:0,startY:0,endX:0,endY:0,
    curvedWaypoints:true,waypoints:[{x:30,y:30},{x:60,y:10}],tangent:true,headingOffset:10,headingOffsetEnd:30});
  const original=structuredClone(layer.keys);
  reverseBasicMotionSpan(p,[layer.id],0,12);
  const raw=await saveProject(store,p,null),loaded=(await loadProject(store)).project;
  expect(JSON.parse(raw).schemaVersion).toBe(59);expect(loaded).toEqual(p);
  refreshBasicMotionSpan(loaded,[layer.id],0,12);
  for(let i=0;i<=12;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[12-i].shapes[0][field]).toBeCloseTo(original[i].shapes[0][field],10);
  expect(loaded.layers[0].keys[13]).toEqual(original[13]);
  const revisions=await fs.readdir(path.join(dir,'vectors')),bad=structuredClone(p);
  bad.layers[0].motionSpans![0].path!.headingOffset=NaN;
  await expect(saveProject(store,bad,raw)).rejects.toThrow(/correction/);
  expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(revisions);
  expect((await loadProject(store)).manifest).toBe(raw);
});

it('roundtrips schema 51 distance curved reversal and rejects downgraded manifests and invalid saves',async()=>{
  const {project:dir,store}=await fixture(),p=newProject(),layer=p.layers[0];p.duration=10;
  const art:Vector={id:'distance-curve',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:90,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[art]},{frame:8,shapes:[{...art,x:96,rotation:150}]},{frame:9,shapes:[]}];
  createBasicMotionSpan(p,[layer.id],0,8,'in',undefined,{startX:0,startY:0,endX:0,endY:0,distance:true,
    curvedWaypoints:true,waypoints:[{x:48,y:32}],waypointTangents:[{x:16,y:32},{x:16,y:0},{x:16,y:-32}],
    tangent:true,headingOffset:10,headingOffsetEnd:30});
  const original=structuredClone(layer.keys);
  reverseBasicMotionSpan(p,[layer.id],0,8);
  const raw=await saveProject(store,p,null),loaded=(await loadProject(store)).project;
  expect(JSON.parse(raw).schemaVersion).toBe(59);expect(loaded).toEqual(p);
  refreshBasicMotionSpan(loaded,[layer.id],0,8);
  for(let i=0;i<=8;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[8-i].shapes[0][field]).toBeCloseTo(original[i].shapes[0][field],10);
  const revisions=await fs.readdir(path.join(dir,'vectors'));
  for(const headingOffsetEnd of [NaN,Infinity,360001]){
    const bad=structuredClone(p);bad.layers[0].motionSpans![0].path!.headingOffsetEnd=headingOffsetEnd;
    await expect(saveProject(store,bad,raw)).rejects.toThrow(/correction/);
  }
  expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(revisions);
  expect((await loadProject(store)).manifest).toBe(raw);
  for(const [outer,inner] of [[50,50],[51,50],[50,51]]){
    const old=JSON.parse(raw);old.schemaVersion=outer;old.document.schemaVersion=inner;
    await fs.writeFile(path.join(dir,'project.json'),JSON.stringify(old));
    await expect(loadProject(store)).rejects.toThrow(/schema 51/i);
  }
});

it.each([2,4,6])('physically retains distance curved tangent subdivision at %i',async(at)=>{
  const {project:dir,store}=await fixture(),p=newProject(),layer=p.layers[0];p.duration=10;
  const art:Vector={id:'distance-split',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:90,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[art]},{frame:8,shapes:[{...art,x:96,y:96,rotation:150}]},{frame:9,shapes:[]}];
  const bend=1/4096;
  createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,distance:true,
    curvedWaypoints:true,waypoints:[{x:48,y:48}],waypointTangents:[
      {x:16-bend,y:16+bend},{x:16-bend,y:16+bend},{x:16-bend,y:16+bend}],
    tangent:true,headingOffset:10,headingOffsetEnd:30});
  const original=structuredClone(layer.keys);
  splitBasicMotionSpan(p,[layer.id],0,8,at,true);
  const raw=await saveProject(store,p,null),loaded=(await loadProject(store)).project;
  expect(loaded).toEqual(p);
  for(const span of loaded.layers[0].motionSpans!)refreshBasicMotionSpan(loaded,[layer.id],span.start,span.end);
  for(let i=0;i<=8;i++)for(const field of ['x','y','rotation'] as const)
    expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(original[i].shapes[0][field],10);
  expect(loaded.layers[0].keys[9]).toEqual(original[9]);
  const revisions=await fs.readdir(path.join(dir,'vectors')),bad=structuredClone(p);
  bad.layers[0].motionSpans![1].path!.headingOffsetEnd=NaN;
  await expect(saveProject(store,bad,raw)).rejects.toThrow(/correction/);
  expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(revisions);
  expect((await loadProject(store)).manifest).toBe(raw);
});

it('physically roundtrips current-schema independent opacity on root and isolated tracks without failed-save writes',async()=>{
 const {project:dir,store}=await fixture(),p=newProject('Opacity channel files');p.duration=8;
 const art:Vector={id:'art',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],opacity:.2};p.layers[0].keys=[{frame:0,shapes:[art]},{frame:4,shapes:[{...art,x:80,opacity:.8}]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'in',undefined,undefined,undefined,undefined,{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0});const l=structuredClone(p.layers[0]);p.symbols=[{id:'s',name:'s',width:100,height:100,shapes:l.keys[0].shapes,timeline:{duration:8,keys:l.keys.slice(1),motionSpans:l.motionSpans,layers:[{...structuredClone(l),id:'extra'}]}}];
 const raw=await saveProject(store,p,null),loaded=(await loadProject(store)).project;expect(loaded).toEqual(p);expect(JSON.parse(raw).schemaVersion).toBe(59);const before=await fs.readdir(path.join(dir,'vectors')),bad=structuredClone(p);(bad.layers[0].motionSpans![0].opacityEase as {y1:number}).y1=NaN;
 await expect(saveProject(store,bad,raw)).rejects.toThrow(/easing/);expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(before);expect((await loadProject(store)).manifest).toBe(raw);
});

it('physically roundtrips schema53 independent paint/opacity on root and both symbol tracks',async()=>{
 const {project:dir,store}=await fixture(),p=newProject('Paint channel files');p.duration=8;
 const art:Vector={id:'art',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#000000',stroke:'#000000',strokeWidth:2,points:[],opacity:0};
 p.layers[0].keys=[{frame:0,shapes:[art]},{frame:4,shapes:[{...art,x:80,fill:'#808080',stroke:'#808080',opacity:1}]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,4,'in',{paint:true},undefined,undefined,undefined,'out',{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0});
 const l=structuredClone(p.layers[0]);p.symbols=[{id:'s',name:'s',width:100,height:100,shapes:l.keys[0].shapes,timeline:{duration:8,keys:l.keys.slice(1),motionSpans:l.motionSpans,layers:[{...structuredClone(l),id:'extra'}]}}];
 const raw=await saveProject(store,p,null),loaded=(await loadProject(store)).project;expect(loaded).toEqual(p);expect(JSON.parse(raw).schemaVersion).toBe(59);
 refreshBasicMotionSpan(loaded,[loaded.layers[0].id],0,4);expect(loaded.layers[0].keys).toEqual(p.layers[0].keys);
 const revisions=await fs.readdir(path.join(dir,'vectors')),bad=structuredClone(p);(bad.symbols![0].timeline!.layers![0].motionSpans![0].paintEase as {y1:number}).y1=NaN;
 await expect(saveProject(store,bad,raw)).rejects.toThrow(/easing/);expect(await fs.readdir(path.join(dir,'vectors'))).toEqual(revisions);expect((await loadProject(store)).manifest).toBe(raw);
});
it('physically upgrades schema52 without materializing paint easing or changing authored artwork',async()=>{
 const {store}=await fixture(),p=newProject('Older independent opacity');p.duration=8;
 const art:Vector={id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#000000',stroke:'#000000',strokeWidth:0,points:[],opacity:0};
 p.layers[0].keys=[{frame:0,shapes:[art]},{frame:4,shapes:[{...art,x:80,fill:'#808080',opacity:1}]}];createBasicMotionSpan(p,[p.layers[0].id],0,4,'in',{paint:true},undefined,undefined,undefined,'out');
 const raw=await saveProject(store,p,null),old=JSON.parse(raw);old.schemaVersion=52;old.document.schemaVersion=52;const legacy=JSON.stringify(old);await store.commit('project.json',legacy,raw);
 const loaded=(await loadProject(store)).project;expect(loaded).toEqual(p);expect(Object.hasOwn(loaded.layers[0].motionSpans![0],'paintEase')).toBe(false);
 const upgraded=await saveProject(store,loaded,legacy);expect(JSON.parse(upgraded).schemaVersion).toBe(59);expect((await loadProject(store)).project).toEqual(p);
});

it('physically roundtrips sparse live endpoints and rejects downgrade/invalid-save requests without new revisions', async () => {
  const { project: dir, store } = await fixture(), p = newProject('Sparse motion'); p.duration = 100000;
  const art: Vector = { id: 'art', kind: 'rectangle', x: 0, y: 0, width: 40, height: 30, rotation: 0, fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [] };
  p.layers[0].keys = [{ frame: 0, shapes: [art] }, { frame: 99999, shapes: [{ ...art, x: 80 }] }];
  p.assets.push({ id: 'opaque', path: 'assets/opaque.bin' });
  const bytes = Buffer.from([0, 255, 42, 0]); await fs.writeFile(path.join(dir, 'assets/opaque.bin'), bytes);
  const live = prepareCreateLiveMotionSpans(p, [{ layerId: p.layers[0].id, span: { id: 'live', start: 0, end: 99999, ease: 'linear' } }]);
  const raw = await saveProject(store, live, null), loaded = await loadProject(store);
  expect(JSON.parse(raw).schemaVersion).toBe(59); expect(loaded.project).toEqual(live);
  const timeline = JSON.parse(await store.read(JSON.parse(raw).timeline)); expect(timeline[0].keys).toHaveLength(2);
  const view = captureLiveMotionTimeline(() => ({ project: loaded.project, revision: 0 }));
  expect(view.sample(50000)[0].key.shapes[0].x).toBeCloseTo(80 * 50000 / 99999); view.dispose();
  expect(await fs.readFile(path.join(dir, 'assets/opaque.bin'))).toEqual(bytes);
  const revisions = await fs.readdir(path.join(dir, 'vectors')), invalid = structuredClone(live);
  invalid.layers[0].liveMotionSpans![0].end = NaN;
  await expect(saveProject(store, invalid, raw)).rejects.toThrow(/finite/);
  expect(await fs.readdir(path.join(dir, 'vectors'))).toEqual(revisions); expect((await loadProject(store)).manifest).toBe(raw);
  for (const [outer, inner] of [[53, 54], [54, 53], [53, 53]]) {
    const old = JSON.parse(raw); old.schemaVersion = outer; old.document.schemaVersion = inner;
    const text = JSON.stringify(old); await store.commit('project.json', text, raw);
    await expect(loadProject(store)).rejects.toThrow(/schema 54/i); await store.commit('project.json', raw, text);
  }
  expect((await loadProject(store)).project).toEqual(live);
});

it('physically preserves layer outline preferences through save and autosave', async () => {
  const { store } = await fixture(),
    p = newProject();
  p.layers[0].outline = true;
  p.layers[0].outlineColor = '#ff8800';
  const saved = structuredClone(p),
    raw = await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  p.layers[0].outline = false;
  p.layers[0].outlineColor = '#00ff00';
  const next = await saveProject(store, p, null, true);
  expect(next).not.toBe(raw);
  expect((await loadProject(store, true)).project).toEqual(p);
  expect((await loadProject(store)).project).toEqual(saved);
});

it('physically preserves saved mask membership and all member artwork through directory reopen',async()=>{
  const {store}=await fixture(),p=newProject();p.layers=['Paint','Extra','Mask'].map(name=>newLayer(name));
  const source=p.layers[2],member=p.layers[0],extra=p.layers[1];
  const q=prepareMaskMember(prepareMaskLayer(p,source.id,true),source.id,member.id),before=structuredClone(q);
  await saveProject(store,q,null);const opened=await loadProject(store);
  expect(opened.project).toEqual(q);expect(opened.project.layerMasks).toEqual([{maskLayerId:source.id,layerIds:[extra.id,member.id]}]);expect(q).toEqual(before);
});
