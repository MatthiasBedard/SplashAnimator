import { isDynamicTextBinding, isDynamicTextInstanceName } from '../../document/src/dynamic-text';
import { createScriptText, scriptTextStateKey } from './dynamic-text';
import { cloneScriptState, type ScriptState } from './timeline';

export type ScriptTextInput = {
  binding: string;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
};

export function captureScriptTextInput(source: unknown): ScriptTextInput {
  if (!source || typeof source !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(source)))
    throw Error('Input text requires explicit field data.');
  const fields = ['binding', 'value', 'selectionStart', 'selectionEnd', 'selectionDirection'] as const;
  const values = fields.map((name) => {
    const field = Object.getOwnPropertyDescriptor(source, name);
    if (!field?.enumerable || !('value' in field)) throw Error('Input text requires explicit field data.');
    return field.value as unknown;
  });
  if (Reflect.ownKeys(source).length !== fields.length) throw Error('Unexpected input text data.');
  const [binding, value, start, end, selectionDirection] = values;
  if (!isDynamicTextBinding(binding) || typeof value !== 'string' || value.length > 10000 ||
      typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > value.length ||
      (selectionDirection !== 'forward' && selectionDirection !== 'backward' && selectionDirection !== 'none'))
    throw Error('Invalid input text value or selection.');
  return { binding, value, selectionStart: start, selectionEnd: end, selectionDirection };
}

export function prepareScriptTextInputState(state: ScriptState, input: ScriptTextInput): ScriptState {
  const staged = cloneScriptState(state);
  createScriptText(staged, scriptTextStateKey, isDynamicTextBinding, isDynamicTextInstanceName)
    .set(input.binding, input.value);
  return cloneScriptState(staged);
}
