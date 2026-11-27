import { expect, it } from 'vitest';
import { newProject } from '../packages/document/src';
import { captureDimensions, exportHTML } from '../packages/export-web/src';
it('rejects invalid fixed capture frames before export', () => {
  const p = newProject(); p.duration = 4;
  for (const frame of [-1, 4, 1.5, NaN, Infinity]) expect(() => exportHTML(p, frame)).toThrow('Choose a frame');
});

it('bounds scaled raster allocation without changing document dimensions',()=>{
  expect(captureDimensions(101,81,0.5)).toEqual({width:51,height:41});
  expect(captureDimensions(120,80,4)).toEqual({width:480,height:320});
  for(const scale of [0,-1,NaN,Infinity,1e300])expect(()=>captureDimensions(120,80,scale)).toThrow();
  expect(()=>captureDimensions(16385,1,1)).toThrow();expect(()=>captureDimensions(9000,9000,1)).toThrow();
});
