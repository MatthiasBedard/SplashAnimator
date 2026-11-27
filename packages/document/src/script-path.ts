export function isScriptPath(path: string): boolean {
  if (!path.startsWith('scripts/') || !path.endsWith('.ts')) return false;
  return path
    .split('/')
    .every(
      (part) =>
        /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) &&
        !part.endsWith('.') &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
    );
}
