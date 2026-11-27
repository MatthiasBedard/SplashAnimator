import type { Project } from '../../document/src';
import { decodePlayerIcon, playerPolicy, preparePlayerAssets } from './player';
import source from '../ios/SplashPlayer.swift?raw';
import projectTemplate from '../ios/project.pbxproj?raw';
import info from '../ios/Info.plist?raw';
import instructions from '../ios/BUILD.txt?raw';

async function appIcon() {
  const bitmap = await createImageBitmap(decodePlayerIcon());
  const canvas = document.createElement('canvas');
  try {
    canvas.width = canvas.height = 1024;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw Error('Could not prepare the iOS app icon.');
    context.fillStyle = '#20232a';
    context.fillRect(0, 0, 1024, 1024);
    context.drawImage(bitmap, 0, 0, 1024, 1024);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Could not encode the iOS app icon.')), 'image/png');
    });
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

export async function prepareIOSProjectApp(project: Project) {
  const { title, filename, identifier, index, script } = await preparePlayerAssets(project);
  // The title is a plist value. Keep Xcode from interpreting it as a build-setting reference.
  const label = title.replace(/\$(?=[({])/g, '＄').replace(/[\uFFFE\uFFFF]/g, '\uFFFD')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const viewport = 'html,body{width:100%;height:100%;overflow:hidden}'
    + 'body{grid-template:minmax(0,1fr)/minmax(0,1fr)}'
    + 'canvas{width:min(100vw,calc(100vh * ' + (project.width / project.height) + '));height:auto;min-width:0;min-height:0}';
  const policy = playerPolicy.replace("script-src 'self'", "script-src 'unsafe-inline'");
  const embedded = index.replace('<style>', '<meta http-equiv="Content-Security-Policy" content="' + policy + '"><style>')
    .replace('</style>', viewport + '</style>')
    .replace('<script src="./player.js"></script>', () => '<script>' + script + '</script>');
  const catalog = { info: { author: 'xcode', version: 1 } };
  const icon = 'Assets.xcassets/AppIcon.appiconset/';
  const files = new Map<string, Blob>();
  for (const [name, contents] of Object.entries({
    'BUILD.txt': instructions,
    'SplashPlayer.xcodeproj/project.pbxproj': projectTemplate.replaceAll('SPLASH_BUNDLE_ID', 'com.splashanimator.project.p' + identifier),
    'Info.plist': info.replace('SPLASH_APP_TITLE', () => label),
    'SplashPlayer.swift': source,
    'index.html': embedded,
    'Assets.xcassets/Contents.json': JSON.stringify(catalog),
    [icon + 'Contents.json']: JSON.stringify({ ...catalog, images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }] }),
  })) files.set(name, new Blob([contents]));
  files.set(icon + 'AppIcon.png', await appIcon());
  return { filename: filename + '-ios-app.zip', files };
}
