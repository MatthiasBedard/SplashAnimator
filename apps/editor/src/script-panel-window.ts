import type { FileCommand, FileOperation, FrameScriptFile, ScriptWorkspace } from './script-workspace';
type Dock = 'canvas' | 'timeline';
type ScriptWindowKind = 'desktop' | 'popup' | 'picture-in-picture';
type SaveCommand = Extract<FileCommand, { op: 'save' }>;
type DocumentPictureInPicture = {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
};
function pictureInPictureAPI() {
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture;
}
export function supportsScriptPictureInPicture() {
  return !!pictureInPictureAPI()?.requestWindow;
}
type View = {
  workspace: ScriptWorkspace;
  frameFiles: FrameScriptFile[];
  timelineName?: string;
  source: string;
  savedSource?: string;
  frameNumber?: number;
  selection?: { source: string; line: number; column: number };
};
export function openScriptWindow(
  view: () => View,
  draft: (text: string, workspace: ScriptWorkspace) => void,
  commit: (text: string | null) => void,
  redock: (where?: Dock) => void,
  failed: (error: string) => void,
  operate: FileOperation,
  acknowledgeLateSave: (command: SaveCommand) => void,
  kind: ScriptWindowKind = 'desktop',
) {
  const browser = kind !== 'desktop';
  const session = crypto.randomUUID();
  const channel = new BroadcastChannel('splash-script-' + session);
  let closed = false,
    ready = false,
    returnRequested = false,
    popup: Window | undefined,
    popupPoll: number | undefined,
    nativeCloseTimer: number | undefined,
    unlisten: (() => void) | undefined;
  const savedFrameTabs = new Map<string, string | null>();
  const savedFiles = new Map<string, SaveCommand>();
  let pendingFrameFiles: FrameScriptFile[] | undefined;
  const invoke = (action: string) =>
    import('@tauri-apps/api/core').then((api) =>
      api.invoke('script_panel_window', { session, action }),
    );
  const timer = window.setTimeout(() => {
    if (!ready && !closed) failed('The script window did not open. Your draft is back in the workspace.');
  }, 15000);
  function dispose() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(popupPoll);
    clearTimeout(nativeCloseTimer);
    unlisten?.();
    window.removeEventListener('pagehide', dispose);
    channel.postMessage({ type: 'shutdown' });
    channel.close();
    if (browser) popup?.close();
    else void invoke('close').catch(() => {});
  }
  channel.onmessage = ({ data }) => {
    if (closed) return;
    if (data.type === 'ready') {
      if (ready) return;
      ready = true;
      clearTimeout(timer);
      const initial = view();
      channel.postMessage({ type: 'init', ...initial, frameFiles: pendingFrameFiles ?? initial.frameFiles, kind });
      if (returnRequested) channel.postMessage({ type: 'return' });
      return;
    }
    if (data.type === 'file') {
      const command = data.command as Parameters<FileOperation>[0];
      void operate(command).then(
        (value) => {
          if (command.op === 'save' && command.path.startsWith('Frames/')) savedFrameTabs.set(command.path, command.text);
          else if (command.op === 'save') {
            if (closed) acknowledgeLateSave(command);
            else savedFiles.set(command.path, command);
          }
          if (command.op === 'remove' && command.path.startsWith('Frames/')) savedFrameTabs.set(command.path, null);
          if (!closed) channel.postMessage({ type: 'fileResult', id: data.id, value });
        },
        (error) => {
          if (!closed)
            channel.postMessage({ type: 'fileResult', id: data.id, error: String(error) });
        },
      );
      return;
    }
    if (typeof data.source !== 'string') return;
    if (data.type === 'draft' || data.type === 'dock' || data.type === 'closed') {
      const workspace = data.workspace as ScriptWorkspace;
      // A draft snapshot can arrive before the window has processed a save acknowledgement.
      for (const tab of workspace?.tabs ?? []) {
        const saved = savedFrameTabs.get(tab.path);
        if (saved !== undefined) tab.original = saved;
        const file = savedFiles.get(tab.path);
        if (file && tab.original === file.expected) tab.original = file.text;
      }
      draft(data.source, workspace);
    }
    if (data.type === 'closed') redock();
    if (data.type === 'dock' && (data.where === 'canvas' || data.where === 'timeline'))
      redock(data.where);
    if (data.type === 'commit' && (data.text === null || typeof data.text === 'string')) {
      try {
        commit(data.text);
        channel.postMessage({ type: 'result', id: data.id });
      } catch (error) {
        channel.postMessage({ type: 'result', id: data.id, error: String(error) });
      }
    }
  };
  window.addEventListener('pagehide', dispose);
  function watchBrowserWindow(opened: Window) {
    popup = opened;
    let sawClosed = false;
    popupPoll = window.setInterval(() => {
      if (!popup?.closed) return;
      // Give the closing window's final draft message a chance to arrive first.
      if (sawClosed) redock();
      sawClosed = true;
    }, 250);
  }
  const url = new URL(window.location.href);
  url.hash = 'script-panel=' + session;
  if (kind === 'picture-in-picture') {
    void (async () => {
      const api = pictureInPictureAPI();
      if (!api) throw new Error('This browser does not support an always-on-top Script Editor.');
      // Call before awaiting anything else so the click authorizes the window.
      const opened = await api.requestWindow({ width: 900, height: 680 });
      if (closed) {
        opened.close();
        return;
      }
      watchBrowserWindow(opened);
      const doc = opened.document;
      doc.title = 'Script Editor · Splash Animator';
      doc.body.style.cssText = 'margin:0;background:#252830';
      const frame = doc.createElement('iframe');
      frame.title = 'Script Editor';
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
      frame.src = url.href;
      doc.body.append(frame);
    })().catch(() => {
      if (!closed) failed('The always-on-top window could not open. Try the regular Pop Out window.');
    });
  } else if (kind === 'popup') {
    try {
      // Open from the click itself so popup permission follows the user gesture.
      const opened = window.open('about:blank', '_blank', 'popup,width=900,height=680,resizable=yes');
      if (!opened) throw new Error('The browser blocked the Script Editor popup. Allow popups for Splash Animator and try again.');
      watchBrowserWindow(opened);
      opened.opener = null;
      opened.location.replace(url.href);
    } catch (error) {
      dispose();
      throw error;
    }
  } else void (async () => {
    const { listen } = await import('@tauri-apps/api/event');
    const off = await listen<string>('script-panel-closed', (e) => {
      if (!closed && e.payload === session)
        nativeCloseTimer = window.setTimeout(() => { if (!closed) redock(); }, 250);
    });
    unlisten = off;
    const offRequest = await listen<string>('script-panel-close-requested', (e) => {
      if (closed || e.payload !== session || returnRequested) return;
      returnRequested = true;
      if (ready) channel.postMessage({ type: 'return' });
    });
    if (closed) {
      off();
      offRequest();
      return;
    }
    unlisten = () => { off(); offRequest(); };
    await invoke('open');
    if (closed) await invoke('close');
  })().catch((error) => {
    if (!closed) failed(String(error));
  });
  return {
    updateFrameFiles: (frameFiles: FrameScriptFile[]) => {
      pendingFrameFiles = frameFiles;
      if (ready && !closed) channel.postMessage({ type: 'frameFiles', frameFiles });
    },
    dispose,
    focus: () => {
      if (browser) popup?.focus();
      else void invoke('focus').catch(() => {});
    },
    requestReturn: () => {
      if (closed) return;
      returnRequested = true;
      if (ready) channel.postMessage({ type: 'return' });
    },
  };
}
