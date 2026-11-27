import { isGenericFontFamily } from '../../../packages/geometry/src/font-family';

export function catalogFontFamilies(faces: readonly { family: unknown }[]) {
  const families = new Map<string, string>();
  for (const face of faces) {
    const value = face.family;
    const family = typeof value === 'string' ? value.trim() : '';
    // Choices must fit the existing saved family syntax.
    if (!/^[a-zA-Z0-9 _-]{1,100}$/.test(family) || !/[a-zA-Z0-9_]/.test(family)) continue;
    const key = family.toLowerCase();
    if (!families.has(key) && !isGenericFontFamily(family)) families.set(key, family);
  }
  return [...families.values()].sort((a, b) => a.localeCompare(b));
}

export function describeFontStack(font: string | undefined, families: readonly string[]) {
  const installed = new Set(families.map(family => family.toLowerCase()));
  const stack = font?.split(',').map(family => family.trim()).filter(Boolean) ?? [];
  const available = (family: string) => {
    const key = family.toLowerCase();
    return installed.has(key) || isGenericFontFamily(family);
  };
  return { missing: stack.filter(family => !available(family)), matched: stack.find(available) };
}
