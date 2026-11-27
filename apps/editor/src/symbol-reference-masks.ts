import type { Vector } from '../../../packages/document/src';
import type { LayerMask } from '../../../packages/document/src/layer-masks';
import type { SymbolEditContext } from '../../../packages/geometry/src/symbol-context';

type ReferenceArt = { shape: Vector; outline?: string | null };

type ReferenceTrack = {
  id: string;
  visible: true;
  masked: boolean;
  art: ReferenceArt[];
};

/** Extract the original mask run around the live symbol slot. */
export function extractEditedSymbolMask(reference: SymbolEditContext, mask: LayerMask) {
  const layers = reference.referenceLayers!;
  const members = new Set(mask.layerIds);
  const editingSource = layers.root === mask.maskLayerId;
  function separate(side: 'under' | 'over', shapes: Vector[], outlines?: (string | null)[]) {
    const membersArt: ReferenceArt[] = [], sourceArt: ReferenceArt[] = [], remaining: Vector[] = [];
    const remainingOutlines: (string | null)[] = [], owners: (string | null)[] = [];
    shapes.forEach((shape, i) => {
      const owner = layers[side][i], outline = outlines?.[i] ?? null;
      if (owner === mask.maskLayerId || (owner === null && editingSource)) sourceArt.push({ shape });
      else if (owner === null || members.has(owner)) membersArt.push({ shape, outline });
      else {
        remaining.push(shape);
        remainingOutlines.push(outline);
        owners.push(owner);
      }
    });
    layers[side] = owners;
    return { membersArt, sourceArt, remaining, remainingOutlines };
  }
  const under = separate('under', reference.under, reference.underOutline);
  const over = separate('over', reference.over, reference.overOutline);
  reference.under = under.remaining;
  reference.underOutline = under.remainingOutlines;
  reference.over = over.remaining;
  reference.overOutline = over.remainingOutlines;
  return {
    editingSource,
    sourceUnder: under.sourceArt, sourceOver: over.sourceArt,
    under: under.membersArt, over: over.membersArt,
  };
}

/** Preserve the original stack while giving the compositor complete mask runs. */
export function prepareSymbolReferencePass(
  shapes: Vector[], outlines: (string | null)[] | undefined,
  owners: (string | null)[], masks: readonly LayerMask[],
) {
  const ownership = new Map<string, LayerMask>();
  for (const mask of masks)
    for (const id of [...mask.layerIds, mask.maskLayerId]) ownership.set(id, mask);
  const layers: ReferenceTrack[] = [], capturedMasks: LayerMask[] = [];
  const capturedTracks = new Map<string, ReferenceTrack>();
  const addTrack = (masked: boolean) => {
    const track: ReferenceTrack = { id: String(layers.length), visible: true, masked, art: [] };
    layers.push(track);
    return track;
  };
  shapes.forEach((shape, i) => {
    const owner = owners[i];
    const mask = owner && ownership.get(owner);
    const item = { shape, outline: outlines?.[i] };
    if (owner && mask) {
      if (!capturedTracks.has(owner)) {
        const make = (id: string) => {
          const track = addTrack(true);
          capturedTracks.set(id, track);
          return track.id;
        };
        const layerIds = mask.layerIds.map(make);
        capturedMasks.push({ layerIds, maskLayerId: make(mask.maskLayerId) });
      }
      capturedTracks.get(owner)!.art.push(item);
    } else {
      const last = layers.at(-1);
      (last && !last.masked ? last : addTrack(false)).art.push(item);
    }
  });
  return capturedMasks.length ? { layers, masks: capturedMasks } : undefined;
}
