import {expect,it} from 'vitest';
import {sourceSelection} from '../apps/editor/src/source-selection';
it('selects original UTF-16 offsets without splitting an astral character',()=>{
  expect(sourceSelection('first\r\n😀x\rthird',{line:2,column:1})).toEqual({start:7,end:9});
  expect(sourceSelection('\uFEFFone\u2028last\u2029😀',{line:3,column:1})).toEqual({start:10,end:12});
  expect(sourceSelection('first\nsecond',{line:2,column:7})).toEqual({start:12,end:12});
  expect(sourceSelection('first\n',{line:2,column:1})).toEqual({start:6,end:6});
});
it('rejects invalid lines and columns without clamping',()=>{
  for(const location of [{line:0,column:1},{line:1,column:0},{line:3,column:1},{line:1,column:7},{line:1.5,column:1},{line:1,column:Infinity}])
    expect(sourceSelection('first\nnext',location)).toBeUndefined();
});
