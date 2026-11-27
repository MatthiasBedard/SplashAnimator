import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Vector } from '../packages/document/src';

// The artist can overwrite this scene in place. Run exact saved-artwork
// assertions only on the reported revision; generated tests run everywhere.
function savedFrame(path: string, revisionHash: string): Vector[] | undefined {
  if (!existsSync(path)) return;
  const bytes = readFileSync(path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== revisionHash) return;
  const frames: Record<string, Vector[]> = JSON.parse(bytes.toString('utf8'));
  return Object.values(frames)[0];
}

export function brokenFrame() {
  return savedFrame('.local-projects/broken.spl/vectors/6f404c97-32ab-4116-87a3-eab4eb9a4fd6.json',
    '7db369c542e798dda041d1e87b20a150be8ef88f3928ac7e4751d8b0210c26c0');
}

export function mergeFailFrame() {
  return savedFrame('.local-projects/merge fail.spl/vectors/01badabd-6557-4134-a2e3-4b0a8cfe054d.json',
    '345aa401672415f8a62412f029819374a52eeb922c3ccb8402e4c509c2980b9d');
}

export function mergeFailTwoFrame() {
  return savedFrame('.local-projects/merge fail 2.spl/vectors/b553f0e8-1c38-4bf3-86a3-282c702cee71.json',
    '3347684bc6f33b58ae13d896b7f3a183fa9ca9279b56cb15b3d56235c8f65a0e');
}

export function mergeFailTwoPurpleFrame() {
  return savedFrame('.local-projects/merge fail 2.spl/vectors/358ffd19-a2ba-42ed-b0fb-c1fc53f10843.json',
    'b3d118befdb8336e089a1a8f9a21f301aadee1ebea4d10ee9df2584123d7325b');
}

export function mergeFailThreeFrame() {
  return savedFrame('.local-projects/merge fail 3.spl/vectors/c0149f5f-82f8-4249-a73b-35c1a71a97bd.json',
    '2b04b1388c3d47121000eb999b7b68188ab3e7bec8eae5908ffbe6ef71ceffdb');
}

export function selectFailFrame() {
  return savedFrame('.local-projects/select fail.spl/vectors/c4d104a4-cf89-4f3d-9be4-d4a00177ca5f.json',
    '15465b1e3c75113c23ac7f0d35b87640007b7c8ad19c89d5c37af9e38c1e65fa');
}

export function anotherMergeFailFrame() {
  return savedFrame('.local-projects/another merge fail.spl/vectors/cb7dcff9-6407-41a5-a44d-efc1d89022a9.json',
    '80081214113d42b574d75e817d364e2fcaaee5cb3293894a5d5a421d5f439019');
}
