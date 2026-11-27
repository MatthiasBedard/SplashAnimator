import { expect, it } from 'vitest';
import { parseScriptStateStop } from '../packages/scripting/src/stop-state';
it('parses literal paths and typed primitive values without evaluating expressions', () => {
  for (const [text, value] of [
    ['null', null],
    ['true', true],
    ['2', 2],
    ['"2"', '2'],
  ] as const)
    expect(parseScriptStateStop('["a.b", "0", "a/b"]', text)).toEqual({
      path: ['a.b', '0', 'a/b'],
      equals: value,
    });
  expect(parseScriptStateStop('[""]', '""')).toEqual({ path: [''], equals: '' });
});
it('rejects malformed, oversized and unsupported original conditions', () => {
  for (const path of [
    '',
    'score',
    '[]',
    '[0]',
    '[null]',
    '["constructor"]',
    JSON.stringify(Array(17).fill('x')),
    JSON.stringify(['x'.repeat(129)]),
    ' '.repeat(16385),
  ])
    expect(() => parseScriptStateStop(path, '1')).toThrow();
  for (const value of [
    '',
    'undefined',
    '1+1',
    '{}',
    '[]',
    '1e999',
    JSON.stringify('x'.repeat(1025)),
    ' '.repeat(8193),
  ])
    expect(() => parseScriptStateStop('["score"]', value)).toThrow();
});

it('parses only explicit finite numeric ordered conditions while preserving omitted equality shape', () => {
  expect(parseScriptStateStop('["n"]', '2')).toEqual({ path: ['n'], equals: 2 });
  for (const comparison of ['lt', 'lte', 'gt', 'gte'] as const) {
    expect(parseScriptStateStop('["n"]', '-1e300', comparison)).toEqual({
      path: ['n'],
      comparison,
      value: -1e300,
    });
    for (const target of ['null', 'false', '"2"', '[]', '{}', '1e999', 'undefined', '1+1'])
      expect(() => parseScriptStateStop('["n"]', target, comparison)).toThrow();
  }
  expect(() => parseScriptStateStop('["n"]', '2', 'bad' as never)).toThrow();
});

it('rejects explicit absent or forged comparison selectors without reinterpreting them as equality',()=>{for(const op of [undefined,null,false,'','equals()'])expect(()=>parseScriptStateStop('["n"]','0',op as never)).toThrow();});
