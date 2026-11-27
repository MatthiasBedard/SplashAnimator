import type { Project } from '../../document/src';
import { decodePlayerIcon, playerPolicy, preparePlayerAssets } from './player';
import settings from '../android/settings.gradle?raw';
import build from '../android/build.gradle?raw';
import manifest from '../android/AndroidManifest.xml?raw';
import activity from '../android/PlayerActivity.java?raw';
import instructions from '../android/BUILD.txt?raw';

export async function prepareAndroidProjectApp(project: Project) {
  const { title, filename, identifier, index, script } = await preparePlayerAssets(project);
  // Android string resources interpret quotes and backslashes after XML decoding.
  const label = title.replace(/["\\]/g, '\\$&').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const aspect = project.width / project.height;
  const viewport = 'html,body{width:100%;height:100%;overflow:hidden}'
    + 'body{grid-template:minmax(0,1fr)/minmax(0,1fr)}'
    + 'canvas{width:min(100vw,calc(100vh * ' + aspect + '));height:auto;min-width:0;min-height:0}';
  const mobileIndex = index.replace('<style>',
    '<meta http-equiv="Content-Security-Policy" content="' + playerPolicy + '"><style>')
    .replace('</style>', viewport + '</style>');
  const files = new Map<string, Blob>();
  for (const [name, contents] of Object.entries({
    'BUILD.txt': instructions,
    'settings.gradle': settings,
    'build.gradle': build,
    'project-app.properties': 'applicationId=com.splashanimator.project.p' + identifier + '\n',
    'src/main/AndroidManifest.xml': manifest,
    'src/main/java/com/splashanimator/player/PlayerActivity.java': activity,
    'src/main/res/values/strings.xml': '<resources><string name="app_name" formatted="false">"'
      + label + '"</string></resources>\n',
    'src/main/assets/index.html': mobileIndex,
    'src/main/assets/player.js': script,
  })) files.set(name, new Blob([contents]));
  files.set('src/main/res/drawable-nodpi/app_icon.png', decodePlayerIcon());
  return { filename: filename + '-android-app.zip', files };
}
