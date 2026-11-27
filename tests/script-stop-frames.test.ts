import {expect,it} from 'vitest';
import {parseScriptStopFrames} from '../packages/scripting/src/stop-frames';
it('preserves supplied order while normalizing one-based frames and duplicates',()=>{
  expect(parseScriptStopFrames(' 5, 2, 05, 1 ',5)).toEqual([4,1,0]);
  expect(parseScriptStopFrames(' \n ',5)).toEqual([]);
  expect(parseScriptStopFrames(Array(999).fill('1').join(','),5)).toEqual([0]);
});
it('rejects malformed and over-budget original values without dropping entries',()=>{
  for(const text of ['0','6','-1','1.5','1e0','+1','1,','1,,2','1 2','NaN','9007199254740993',
    Array(1000).fill('1').join(','),' '.repeat(16001)])
    expect(()=>parseScriptStopFrames(text,5)).toThrow();
  for(const duration of [0,-1,NaN,1.5,Infinity]) expect(()=>parseScriptStopFrames('1',duration)).toThrow();
});
