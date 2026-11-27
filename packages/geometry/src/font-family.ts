/** Self-contained so the standalone painter can use exactly the same font selection. */
export function createFontFamilyResolver() {
  const generics = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)$/i;
  const isGenericFontFamily = (family: string) => generics.test(family);

  function fontFamilyForRendering(stack: string) {
    const families = stack.split(',').map(family => family.trim()).filter(Boolean);
    const css = families.map(family => isGenericFontFamily(family) ? family.toLowerCase() : JSON.stringify(family));
    if (!families.some(isGenericFontFamily)) css.push('sans-serif');
    return css.join(', ');
  }

  return { isGenericFontFamily, fontFamilyForRendering };
}

export const { isGenericFontFamily, fontFamilyForRendering } = createFontFamilyResolver();
