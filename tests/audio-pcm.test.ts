import {expect,it} from 'vitest';
import {audioSampleRange,mixTimelinePcm,type TimelinePcmClip} from '../packages/audio/src/pcm';
const options={startFrame:0,endFrame:4,fps:8000,sampleRate:8000,channelCount:1 as const};
const clip=(samples:number[],startFrame=0,gain=1):TimelinePcmClip=>({startFrame,gain,sampleRate:8000,channels:[new Float32Array(samples)]});
it('mixes gaps, overlaps, gains and source offsets without changing inputs',()=>{
  const clips=[clip([0.5,0.25],1),{...clip([-1,0.5,0.5],2,0.5),offsetSamples:1}],before=structuredClone(clips);
  const result=mixTimelinePcm(clips,options);
  expect(Array.from(result.channels[0])).toEqual([0,0.5,0.5,0.25]);expect(result.peak).toBe(0.5);expect(result.clippedSamples).toBe(0);expect(clips).toEqual(before);
  clips[0].channels[0].fill(0);expect(result.channels[0][1]).toBe(0.5);
});
it('clips only the final sum and reports channel samples and peak',()=>{
  const result=mixTimelinePcm([clip([1,-1,0.5],0,2),clip([-0.5,0.5,-0.5])],options);
  expect(Array.from(result.channels[0])).toEqual([1,-1,0.5,0]);expect(result.peak).toBe(1.5);expect(result.clippedSamples).toBe(2);
  expect(mixTimelinePcm([clip([1],0,2),clip([-1])],options).clippedSamples).toBe(0);
});
it('preserves selected-range sample phase at fractional fps and stereo separation',()=>{
  const base={startFrame:0,endFrame:10,fps:29.97,sampleRate:8000,channelCount:2 as const};
  const frames=audioSampleRange(0,10,29.97,8000).end;
  const clips=[{startFrame:0,sampleRate:8000,channels:[Float32Array.from({length:frames},(_,i)=>i%2?0.25:-0.25),new Float32Array(frames).fill(0.75)]}];
  const whole=mixTimelinePcm(clips,base),range=mixTimelinePcm(clips,{...base,startFrame:3,endFrame:7});
  expect(range.startSample).toBe(Math.round(3*8000/29.97));
  for(let c=0;c<2;c++)expect(range.channels[c]).toEqual(whole.channels[c].slice(range.startSample,range.endSample));
  expect(mixTimelinePcm([],{...options,channelCount:2}).channels).toEqual([new Float32Array(4),new Float32Array(4)]);
});
it('rejects invalid original samples even in inaudible clips and validates all inputs atomically',()=>{
  const valid=clip([0.5]);
  for(const bad of [clip([NaN]),clip([Infinity]),clip([1.01]),{...clip([0]),gain:17},{...clip([0]),offsetSamples:2},{...clip([0]),sampleRate:44100},clip([0],-1),{...clip([0]),channels:[new Float32Array(1),new Float32Array(2)]}]){
    expect(()=>mixTimelinePcm([valid,{...bad,startFrame:bad.startFrame===-1?-1:1000}],options)).toThrow();expect(valid.channels[0][0]).toBe(0.5);
  }
  for(const bad of [{...options,maxBytes:15},{...options,maxWorkSamples:3},{...options,channelCount:3 as 1},{...options,fps:0},{...options,endFrame:0}])expect(()=>mixTimelinePcm([],bad)).toThrow();
  expect(()=>audioSampleRange(0,Number.MAX_SAFE_INTEGER,0.1,48000)).toThrow();
});
it('uses exact output and work budget boundaries with exhausted source offsets',()=>{
  const source={...clip([0.5,0.25]),offsetSamples:2};
  expect(mixTimelinePcm([source],{...options,maxBytes:16,maxWorkSamples:6}).channels[0]).toEqual(new Float32Array(4));
  expect(()=>mixTimelinePcm([source],{...options,maxWorkSamples:5})).toThrow(/work budget/);
});

it('matches ordered scalar mixing across block boundaries, sparse clips and selected ranges',()=>{
  const config={startFrame:3,endFrame:28,fps:29.97,sampleRate:8000,channelCount:2 as const};
  const clips=Array.from({length:24},(_,i)=>({startFrame:i,offsetSamples:i%5,gain:i%3===0?-2:1.5,sampleRate:8000,
    channels:[Float32Array.from({length:1100},(_,j)=>((j*7+i)%17-8)/8),Float32Array.from({length:1100},(_,j)=>((j+i)%9-4)/4)]}));
  const actual=mixTimelinePcm(clips,config),expected=actual.channels.map(c=>new Float32Array(c.length));let peak=0,clipped=0;
  for(let i=0;i<expected[0].length;i++)for(let c=0;c<2;c++){
    const at=actual.startSample+i;let sum=0;
    for(const clip of clips){const index=at-Math.round(clip.startFrame*8000/29.97)+clip.offsetSamples;if(index>=clip.offsetSamples&&index<clip.channels[c].length)sum+=clip.channels[c][index]*clip.gain;}
    peak=Math.max(peak,Math.abs(sum));if(Math.abs(sum)>1)clipped++;expected[c][i]=Math.max(-1,Math.min(1,sum));
  }
  expect(actual.channels).toEqual(expected);expect(actual.peak).toBe(peak);expect(actual.clippedSamples).toBe(clipped);
  const sparse=mixTimelinePcm([clip([1],1023),clip([-1],1024),clip([0.5],4096)],{...options,endFrame:6144});
  expect(sparse.channels[0][1023]).toBe(1);expect(sparse.channels[0][1024]).toBe(-1);expect(sparse.channels[0][4096]).toBe(0.5);
  expect(sparse.channels[0].reduce((n,v)=>n+(v!==0?1:0),0)).toBe(3);
});

it('explicitly duplicates mono and averages stereo before gain and final clipping',()=>{
 const mono=clip([0.5,-1]),stereo={...clip([1,-1]),channels:[new Float32Array([1,-1]),new Float32Array([-1,0.5])]};
 expect(()=>mixTimelinePcm([mono,stereo],options)).toThrow(/channels/);
 const down=mixTimelinePcm([mono,stereo],{...options,convertChannels:true});expect(Array.from(down.channels[0])).toEqual([0.5,-1,0,0]);expect(down.peak).toBe(1.25);expect(down.clippedSamples).toBe(1);
 const up=mixTimelinePcm([mono,stereo],{...options,channelCount:2,convertChannels:true});expect(Array.from(up.channels[0])).toEqual([1,-1,0,0]);expect(Array.from(up.channels[1])).toEqual([-0.5,-0.5,0,0]);
 expect(()=>mixTimelinePcm([mono],{...options,convertChannels:'yes' as unknown as boolean})).toThrow(/conversion/);
 const invalid={...stereo,channels:[stereo.channels[0],new Float32Array([NaN,0])]};expect(()=>mixTimelinePcm([invalid],{...options,convertChannels:true})).toThrow(/samples/);
 expect(()=>mixTimelinePcm([stereo],{...options,convertChannels:true,maxWorkSamples:11})).toThrow(/work budget/);
 expect(mixTimelinePcm([stereo],{...options,convertChannels:true,maxWorkSamples:12}).channels[0][1]).toBe(-0.25);
});

it('applies clip-relative endpoint fades after offsets and preserves selected-range phase',()=>{
 const source={...clip(Array(10).fill(1),2,2),offsetSamples:2,fadeInSamples:3,fadeOutSamples:4};
 const full=mixTimelinePcm([source],{...options,endFrame:12});
 expect(Array.from(full.channels[0])).toEqual([0,0,0,1,1,1,1,1,Math.fround(2/3),0,0,0]);expect(full.peak).toBe(2);expect(full.clippedSamples).toBe(4);
 const selected=mixTimelinePcm([source],{...options,startFrame:4,endFrame:9});expect(selected.channels[0]).toEqual(full.channels[0].slice(4,9));
 expect(mixTimelinePcm([{...clip([1,1,1,1]),fadeInSamples:4,fadeOutSamples:4}],options).channels[0]).toEqual(new Float32Array([0,2/9,2/9,0]));
 expect(mixTimelinePcm([{...clip([1,1,1,1]),fadeInSamples:1,fadeOutSamples:1}],options).channels[0]).toEqual(new Float32Array([0,1,1,0]));
});
it('validates original fade lengths even outside the selected range',()=>{
 for(const value of [-1,1.5,Infinity,NaN,null,5])for(const field of ['fadeInSamples','fadeOutSamples'])expect(()=>mixTimelinePcm([{...clip([1,1,1,1],100),[field]:value}],options)).toThrow(/fade/);
 expect(()=>mixTimelinePcm([{...clip([1,1]),offsetSamples:2,fadeInSamples:1}],options)).toThrow(/fade/);
 const source=clip([NaN]);expect(()=>mixTimelinePcm([{...source,fadeInSamples:1}],options)).toThrow(/samples/);
});
