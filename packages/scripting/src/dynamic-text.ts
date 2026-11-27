import type { ScriptState, ScriptValue } from './timeline';

export const scriptTextStateKey = '$splashText';

/** Self-contained so the isolated worker can install the same API. */
export function createScriptText(
  state: ScriptState,
  key: string,
  validBinding: (value: unknown) => value is string,
  validInstanceName: (value: unknown) => value is string,
) {
  function setValue(target: string, content: string) {
    if (typeof content !== 'string' || content.length > 10000)
      throw Error('Dynamic text needs at most 10,000 text code units.');
    const values: ScriptValue = state[key] ?? Object.create(null);
    if (typeof values !== 'object' || values === null || Array.isArray(values))
      throw Error('Invalid dynamic text state.');
    Object.defineProperty(values, target, {
      value: content, enumerable: true, writable: true, configurable: true,
    });
    state[key] = values;
  }
  return Object.freeze({
    set(binding: string, content: string) {
      if (!validBinding(binding)) throw Error('Dynamic text needs a valid binding.');
      setValue(binding, content);
    },
    setForInstance(instanceName: string, binding: string, content: string) {
      if (!validInstanceName(instanceName) || !validBinding(binding))
        throw Error('Dynamic text needs a valid instance name and binding.');
      setValue(JSON.stringify([instanceName, binding]), content);
    },
  });
}
