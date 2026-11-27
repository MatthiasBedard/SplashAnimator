export type LibrarySelection = { selected: string[]; anchor?: string; focus?: string };
/** Selection belongs to the current sorted/filtered view, never to saved artwork. */
export function pickLibraryItem(
  view: string[],
  state: LibrarySelection,
  key: string,
  modifiers: { toggle?: boolean; range?: boolean; context?: boolean } = {},
): LibrarySelection {
  if (!view.includes(key)) return state;
  const current = state.selected.filter((k) => view.includes(k));
  if (modifiers.context && current.includes(key))
    return { ...state, selected: current, focus: key };
  if (modifiers.range && state.anchor && view.includes(state.anchor)) {
    const a = view.indexOf(state.anchor),
      b = view.indexOf(key),
      range = view.slice(Math.min(a, b), Math.max(a, b) + 1);
    return {
      selected: modifiers.toggle
        ? view.filter((k) => current.includes(k) || range.includes(k))
        : range,
      anchor: state.anchor,
      focus: key,
    };
  }
  return {
    selected: modifiers.toggle
      ? view.filter((k) => (k === key ? !current.includes(k) : current.includes(k)))
      : [key],
    anchor: key,
    focus: key,
  };
}
