import type { Project } from '../../../packages/document/src';
import { PNGArchive } from './png-archive';

export type ProjectAppTarget = 'windows' | 'android' | 'ios';

export async function createProjectAppArchive(project: Project, target: ProjectAppTarget) {
  const { filename, files } = target === 'android'
    ? await (await import('../../../packages/export-app/src/android')).prepareAndroidProjectApp(project)
    : target === 'ios'
      ? await (await import('../../../packages/export-app/src/ios')).prepareIOSProjectApp(project)
      : await (await import('../../../packages/export-app/src')).prepareWindowsProjectApp(project);
  const archive = target === 'windows' ? new PNGArchive() : PNGArchive.forFileTree();
  for (const [name, file] of files) await archive.add(name, file);
  return { filename, blob: archive.finish() };
}
