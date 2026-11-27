import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { installFrameAllocationLimits } from '../packages/scripting/src/frame-allocation';

function run(source: string, arrays = 8, text = 8) {
  return runInNewContext(`
    (${installFrameAllocationLimits.toString()})(${arrays}, ${text}, message => { throw Error(message) });
    ${source}
  `);
}

it('counts cumulative constructor entries and retains intrinsic array behavior', () => {
  expect(run(`
    class Custom extends Array {}
    const a = new Custom(5), b = Array(1, 2, 3);
    [a.length, a instanceof Custom, a instanceof Array, Array.isArray(a),
      ([]).constructor === Array, b.join('')];
  `)).toEqual([5, true, true, true, true, '123']);
  expect(() => run('new Array(5); Array(4);')).toThrow('temporary array allocation limit');
  expect(() => run('new Array(1.25);')).toThrow('Invalid array length');
});

it('counts UTF-16 repeat output and coerces receiver and count once in order', () => {
  expect(run(`
    const seen = [];
    const result = String.prototype.repeat.call(
      { toString() { seen.push('receiver'); return '😀' } },
      { valueOf() { seen.push('count'); return 3.8 } });
    [result, 'a'.repeat(2), seen.join(',')];
  `)).toEqual(['😀😀😀', 'aa', 'receiver,count']);
  expect(() => run('"😀".repeat(3); "a".repeat(3);')).toThrow('temporary repeated text allocation limit');
  expect(run('try { "".repeat(Infinity) } catch (error) { error.name }')).toBe('RangeError');
  expect(run('"a".repeat(NaN);')).toBe('');
});
