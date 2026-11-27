import {expect,it} from 'vitest';
import {createAudioTransport} from '../packages/audio/src/transport';
const config={startFrame:0,endFrame:24,fps:24,sampleRate:8000};
it('starts paused, advances on the supplied clock and ends without wrapping',()=>{
 const clock=createAudioTransport(config);expect(clock.position(10)).toMatchObject({sample:0,frame:0,playing:false});clock.play(10);
 expect(clock.position(10.5)).toMatchObject({sample:4000,frame:12,playing:true});expect(clock.position(11)).toMatchObject({sample:8000,frame:23,ended:true,playing:false});expect(clock.play(12).ended).toBe(true);
 expect(clock.seek(0,12).ended).toBe(false);expect(clock.play(12).playing).toBe(true);
});
it('preserves fractional samples across pause/resume without counting stopped time',()=>{
 const clock=createAudioTransport({...config,sampleRate:8192});clock.play(0);expect(clock.pause(1/16384).sample).toBe(0);expect(clock.position(0.5).sample).toBe(0);clock.play(0.5);expect(clock.position(0.5+1/16384).sample).toBe(1);
});
it('uses absolute rounded sample boundaries for nonzero fractional frame ranges',()=>{
 const c={startFrame:100,endFrame:110,fps:29.97,sampleRate:44100},clock=createAudioTransport(c);const start=Math.round(100*44100/29.97),next=Math.round(101*44100/29.97);
 expect(clock.position(0)).toMatchObject({sample:start,frame:100,offsetSeconds:0});clock.play(0);
 expect(clock.position((next-start-0.25)/44100).frame).toBe(100);expect(clock.position((next-start+0.25)/44100).frame).toBe(101);expect(clock.seek(109,1)).toMatchObject({frame:109,playing:true});
});
it('rejects invalid commands atomically and detaches config and returned positions',()=>{
 const c={...config},clock=createAudioTransport(c);c.endFrame=1;clock.play(2);const first=clock.position(2.25);first.sample=999;
 for(const now of [NaN,Infinity,-1,2])expect(()=>clock.pause(now)).toThrow(/monotonic/);
 for(const frame of [-1,24,0.5,NaN])expect(()=>clock.seek(frame,9)).toThrow(/range/);
 expect(clock.position(2.5)).toMatchObject({sample:4000,frame:12,playing:true});
});
it('handles huge elapsed clocks without overflow and rejects unusable configurations',()=>{
 const clock=createAudioTransport(config);clock.play(0);expect(clock.position(Number.MAX_VALUE)).toMatchObject({sample:8000,ended:true});
 expect(()=>createAudioTransport({...config,fps:8001})).toThrow();expect(()=>createAudioTransport({...config,endFrame:0})).toThrow();
});
it('keeps seek paused or playing and maps every selected frame to its start sample',()=>{
 const c={startFrame:7,endFrame:111,fps:23.976,sampleRate:48000},clock=createAudioTransport(c);
 for(let frame=7;frame<111;frame++){const p=clock.seek(frame,frame);expect(p.frame).toBe(frame);expect(p.sample).toBe(Math.round(frame*48000/23.976));expect(p.playing).toBe(false);}
 clock.play(111);expect(clock.seek(8,112).playing).toBe(true);clock.pause(112);expect(clock.seek(9,113).playing).toBe(false);
});

it('polling does not accumulate clock-rounding drift',()=>{
 const sparse=createAudioTransport(config),dense=createAudioTransport(config);sparse.play(0);dense.play(0);
 for(let i=1;i<5000;i++)dense.position(i/10000);
 expect(dense.position(0.625)).toEqual(sparse.position(0.625));
});
