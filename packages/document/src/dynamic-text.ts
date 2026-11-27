/** Script bindings use a single identifier and exclude reserved JSON object keys. */
export function isDynamicTextBinding(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(value) &&
    value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

export function isDynamicTextInstanceName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && value.trim().length > 0;
}

/** Qualified keys cannot collide with ordinary identifiers or delimiter-bearing names. */
export function parseDynamicTextTarget(key: string): [string, string] | undefined {
  if (key.length > 1280 || !key.startsWith('[')) return;
  try {
    const pair: unknown = JSON.parse(key);
    if (Array.isArray(pair) && pair.length === 2 && isDynamicTextInstanceName(pair[0]) &&
        isDynamicTextBinding(pair[1]) && JSON.stringify(pair) === key) return [pair[0], pair[1]];
  } catch {
    return;
  }
}

export function validateDynamicTextBinding(kind: string, text: unknown): void {
  if (!text || typeof text !== 'object') return;
  const input = Object.getOwnPropertyDescriptor(text, 'input');
  if ('input' in text && (!input?.enumerable || !('value' in input) ||
      input.value !== true || !('dynamicBinding' in text)))
    throw Error('Input text requires an explicit flag and a dynamic text binding.');
  if (!('dynamicBinding' in text)) return;
  const binding = Object.getOwnPropertyDescriptor(text, 'dynamicBinding');
  if (kind !== 'text' || !binding?.enumerable || !('value' in binding) ||
      !isDynamicTextBinding(binding.value))
    throw Error('Dynamic text requires an explicit binding name on a text field.');
}

/** Detached snapshot of the text values admitted to one scripted presentation. */
export function captureDynamicTextValues(input: unknown): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(input)))
    throw Error('Dynamic text values must be a plain record.');
  const result: Record<string, string> = Object.create(null);
  let units = 0;
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || (!isDynamicTextBinding(key) && !parseDynamicTextTarget(key)) ||
        !field?.enumerable || !('value' in field) ||
        typeof field.value !== 'string' || field.value.length > 10000)
      throw Error('Invalid dynamic text value.');
    units += key.length + field.value.length;
    if (units > 65536) throw Error('Dynamic text values exceed the script state budget.');
    result[key] = field.value;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 65536)
    throw Error('Dynamic text values exceed the script state budget.');
  return Object.keys(result).length ? result : undefined;
}
