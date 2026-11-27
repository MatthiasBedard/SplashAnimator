import type { Plugin } from 'vite';
import {audioAssetHandler} from './audio-server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  NodeDirectoryStore,
  createDirectory,
  duplicateDirectory,
} from '../../packages/document/src/node-store';
/** Filesystem bridge for local Vite development. Bundled playback needs no server. */
export function projectServer(): Plugin {
  const root = path.resolve(process.env.SPLASH_PROJECTS || '.local-projects');
  const projectPath = (name: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,80}\.spl$/.test(name))
      throw new Error('Use a project name containing letters, numbers, spaces, - or _');
    return path.join(root, name);
  };
  return {
    name: 'splash-local-projects',
    configureServer(server) {
      server.middlewares.use('/api/audio-assets', audioAssetHandler(root));
      server.middlewares.use('/api/projects', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          // Dev-only bridge: loopback server, same-origin POSTs; no arbitrary host paths.
          if (
            req.method !== 'POST' ||
            req.headers['content-type'] !== 'application/json' ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
            !/^127\.0\.0\.1:1420$/.test(req.headers.host || '')
          )
            throw new Error('Rejected cross-origin or non-loopback request');
          let body = '';
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 32 * 1024 * 1024) throw new Error('Request exceeds limit');
          }
          const q = JSON.parse(body) as {
            op: string;
            project: string;
            path: string;
            content: string;
            expected: string | null;
            source: string;
          };
          await fs.mkdir(root, { recursive: true });
          let result: unknown;
          if (q.op === 'list')
            result = (await fs.readdir(root, { withFileTypes: true }))
              .filter((d) => d.isDirectory() && d.name.endsWith('.spl'))
              .map((d) => d.name);
          else {
            const project = projectPath(q.project);
            const store = new NodeDirectoryStore(project);
            await store.resolve('project.json');
            switch (q.op) {
              case 'create':
                await createDirectory(project);
                result = q.project;
                break;
              case 'duplicate':
                await new NodeDirectoryStore(projectPath(q.source)).resolve('project.json');
                await duplicateDirectory(projectPath(q.source), project);
                result = q.project;
                break;
              case 'listScripts':
                result = await store.listScripts();
                break;
              case 'read':
                result = await store.read(q.path);
                break;
              case 'exists':
                result = await store.exists(q.path);
                break;
              case 'write':
                await store.writeNew(q.path, q.content);
                result = true;
                break;
              case 'commit':
                await store.commit(q.path, q.content, q.expected);
                result = true;
                break;
              default:
                throw new Error('Unknown project operation');
            }
          }
          res.end(JSON.stringify({ result }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}
