import { clone, validateProject, type Project } from './index';
import { validateLiveGraphicData } from './live-motion';
export function prepareMaskLayer(project: Project, id: string, enabled: boolean): Project {
  validateLiveGraphicData(project);
  validateProject(project);
  if (typeof enabled !== 'boolean') throw Error('Choose a mask layer type.');
  const signature = JSON.stringify(project);
  const next = clone(project),
    index = next.layers.findIndex((l) => l.id === id);
  if (index < 0) throw Error('Choose an original mask layer.');
  const masks = (next.layerMasks ?? []).filter((m) => m.maskLayerId !== id);
  if (enabled) {
    delete next.layers[index].guideLayer;
    const existing = next.layerMasks?.find((m) => m.maskLayerId === id);
    if (existing) masks.push(existing);
    else {
      const below = next.layers[index - 1];
      if (!below || below.folderId !== next.layers[index].folderId)
        throw Error('A mask needs a layer directly below it in the same folder.');
      masks.push({ maskLayerId: id, layerIds: [below.id] });
    }
  }
  if (masks.length) next.layerMasks = masks;
  else delete next.layerMasks;
  validateProject(next);
  if (JSON.stringify(project) !== signature)
    throw Error('The original mask layers changed. Try again.');
  return next;
}
export function prepareMaskMember(project: Project, maskId: string, memberId: string): Project {
  validateLiveGraphicData(project);
  validateProject(project);
  const signature = JSON.stringify(project);
  const next = clone(project),
    mask = next.layerMasks?.find((m) => m.maskLayerId === maskId),
    source = next.layers.find((l) => l.id === maskId),
    member = next.layers.find((l) => l.id === memberId);
  if (
    !mask ||
    !source ||
    !member ||
    source === member ||
    member.locked ||
    next.layerMasks?.some((m) => m.maskLayerId === memberId)
  )
    throw Error('Drag an unlocked artwork layer into a mask group.');
  if (mask.layerIds.includes(memberId)) return next;
  for (const prior of next.layerMasks ?? []) {
    if (prior.layerIds.includes(memberId)) {
      if (prior.layerIds.length === 1)
        throw Error('Convert the previous mask to Normal before moving its last layer.');
      prior.layerIds = prior.layerIds.filter((id) => id !== memberId);
    }
  }
  next.layers.splice(next.layers.indexOf(member), 1);
  next.layers.splice(next.layers.indexOf(source), 0, member);
  if (source.folderId) member.folderId = source.folderId;
  else delete member.folderId;
  mask.layerIds = [...mask.layerIds, memberId];
  mask.layerIds.sort(
    (a, b) => next.layers.findIndex((l) => l.id === a) - next.layers.findIndex((l) => l.id === b),
  );
  validateProject(next);
  if (JSON.stringify(project) !== signature)
    throw Error('The original mask layers changed. Try again.');
  return next;
}
