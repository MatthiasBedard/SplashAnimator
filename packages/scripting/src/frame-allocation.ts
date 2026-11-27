export const scriptArraySlotLimit = 1_048_576;
export const scriptRepeatedTextLimit = 1_048_576;

/** Runs inside the disposable worker. Keep it standalone for the worker bootstrap. */
export function installFrameAllocationLimits(
  arraySlots: number,
  textUnits: number,
  reject: (message: string) => never,
): void {
  const NativeArray = Array;
  const repeat = String.prototype.repeat;
  const apply = Reflect.apply, construct = Reflect.construct;
  const define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
  const integer = Number.isInteger, truncate = Math.trunc, finite = Number.isFinite;
  const toString = String;
  function chargeArray(args: unknown[]) {
    const length = args.length === 1 && typeof args[0] === 'number' ? args[0] : args.length;
    // Let the native constructor report invalid lengths exactly as before.
    if (!integer(length) || length < 0 || length > 0xffff_ffff) return;
    if (length > arraySlots) reject('Script temporary array allocation limit exceeded.');
    arraySlots -= length;
  }
  const ArrayWithLimit = new Proxy(NativeArray, {
    apply(target, receiver, args) {
      chargeArray(args);
      return apply(target, receiver, args);
    },
    construct(target, args, newTarget) {
      chargeArray(args);
      return construct(target, args, newTarget);
    },
  });
  define(globalThis, 'Array', { ...descriptor(globalThis, 'Array'), value: ArrayWithLimit });
  define(NativeArray.prototype, 'constructor', {
    ...descriptor(NativeArray.prototype, 'constructor'),
    value: ArrayWithLimit,
  });
  const limited = {
    repeat(this: unknown, count: unknown): string {
      if (this == null || typeof this === 'symbol') return apply(repeat, this, [count]);
      const text = toString(this);
      const repetitions = truncate(+(count as number));
      if (repetitions < 0 || repetitions === Infinity) return apply(repeat, text, [repetitions]);
      if (finite(repetitions)) {
        const length = text.length * repetitions;
        if (length > textUnits) reject('Script temporary repeated text allocation limit exceeded.');
        textUnits -= length;
      }
      return apply(repeat, text, [repetitions]);
    },
  };
  define(String.prototype, 'repeat', { ...descriptor(String.prototype, 'repeat'), value: limited.repeat });
}
