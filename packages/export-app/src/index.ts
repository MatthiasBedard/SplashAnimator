import type { Project } from '../../document/src';
import { decodePlayerIcon, playerPolicy, preparePlayerAssets } from './player';
import cargo from '../template/Cargo.toml?raw';
import lock from '../template/Cargo.lock?raw';
import build from '../template/build.rs?raw';
import main from '../template/main.rs?raw';
import instructions from '../template/BUILD.txt?raw';
import ico from '../../../apps/editor/src-tauri/icons/icon.ico?inline';

const version = '1.0.0';

export async function prepareWindowsProjectApp(project: Project) {
  const { title, filename, identifier, index, script } = await preparePlayerAssets(project);
  const productName = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/ +/g, ' ').trim() ||
    'Splash animation';
  const config = {
    productName,
    version,
    identifier: 'com.splashanimator.project-' + identifier,
    build: { frontendDist: ['index.html', 'player.js'] },
    app: {
      withGlobalTauri: false,
      security: { capabilities: [], csp: playerPolicy },
      windows: [{ title, width: 960, height: 640 }],
    },
    bundle: { active: false, icon: ['icon.ico', 'icon.png'] },
  };
  const files = new Map<string, Blob>();
  for (const [name, contents] of Object.entries({
    'BUILD.txt': instructions, 'Cargo.toml': cargo, 'Cargo.lock': lock,
    'build.rs': build, 'main.rs': main,
    'tauri.conf.json': JSON.stringify(config, null, 2) + '\n',
    'index.html': index, 'player.js': script,
  })) files.set(name, new Blob([contents]));
  files.set('icon.ico', decodePlayerIcon(ico));
  files.set('icon.png', decodePlayerIcon());
  return { filename: filename + '-windows-app.zip', files };
}
