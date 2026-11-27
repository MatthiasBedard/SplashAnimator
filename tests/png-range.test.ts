import { expect, it } from 'vitest';
import { newProject } from '../packages/document/src';
import { pngSheetPages, pngSheetLayout, exportPNGSequence, exportPNGSequenceToSink } from '../apps/editor/src/export-png';

it('rejects invalid PNG ranges before creating a renderer or writing a file',async()=>{
  const project=newProject();project.duration=8;
  for(const range of [{start:-1,end:4},{start:3,end:2},{start:0,end:8},{start:0.5,end:4},{start:0,end:NaN}]){
    await expect(exportPNGSequence(project,undefined,undefined,range)).rejects.toThrow(/within the existing timeline/);
    let writes=0;
    await expect(exportPNGSequenceToSink(project,async()=>{writes++;},undefined,undefined,range)).rejects.toThrow(/within the existing timeline/);
    expect(writes).toBe(0);
  }
});

it('packs sprite sheets within the raster allocation budget',()=>{
  expect(pngSheetLayout(120,80,8)).toEqual({width:360,height:240,columns:3,rows:3});
  expect(pngSheetLayout(16,16,1)).toEqual({width:16,height:16,columns:1,rows:1});
  for(const count of [0,1.5,Infinity,1000000])expect(()=>pngSheetLayout(120,80,count)).toThrow();
});

it('paginates every frame while bounding each atlas and archive entry count',()=>{
  expect(pngSheetPages(16,16,65)).toMatchObject({capacity:64,pages:2,width:128,height:128});
  expect(pngSheetPages(8192,8192,3)).toMatchObject({capacity:1,pages:3,width:8192,height:8192});
  expect(pngSheetPages(120,80,8)).toMatchObject({capacity:8,pages:1,width:360,height:240});
  for(const count of [0,NaN,1.5,64*65533+1])expect(()=>pngSheetPages(16,16,count)).toThrow();
});

it('includes transparent gutters in page budgets without changing frame sizes',()=>{
  expect(pngSheetPages(16,16,65,2)).toMatchObject({width:160,height:160,capacity:64,pages:2,padding:2,cellWidth:20,cellHeight:20});
  expect(pngSheetPages(8192,8192,1,0)).toMatchObject({capacity:1});
  expect(()=>pngSheetPages(8192,8192,1,1)).toThrow();
  for(const padding of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])expect(()=>pngSheetPages(16,16,1,padding)).toThrow();
});
