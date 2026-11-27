import { validateLiveGraphicData } from './live-motion';

export type NodeHintContours = readonly (readonly (readonly [number, number])[])[];
export type ContourOwners = readonly (readonly [number, number] | null)[];
export type ArtworkNodeHints = { sourceId: string; targetId: string; hints: NodeHintContours | null; contourOwners?: ContourOwners };
export type MotionNodeMatching =
  | boolean
  | {
      hints?: NodeHintContours;
      artworkHints?: readonly ArtworkNodeHints[];
      curves?: boolean;
      distance?: boolean;
      /** Explicit editable shape tween: pair independently authored vector artwork. */
      shapes?: boolean;
    };
export function validateMotionNodeMatching(value: unknown): asserts value is MotionNodeMatching {
  if (typeof value === 'boolean') return;
  if (value && typeof value === 'object' && 'artworkHints' in value) {
    validateLiveGraphicData(value);
    if (!Object.hasOwn(value, 'artworkHints')) throw Error('Artwork hints must be authored data.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['artworkHints', 'hints', 'curves', 'distance', 'shapes'].includes(key))
  )
    throw new Error('Invalid node matching recipe.');
  const match = value as Exclude<MotionNodeMatching, boolean>;
  if (
    [match.curves, match.distance, match.shapes].some(
      (v) => v !== undefined && typeof v !== 'boolean',
    ) ||
    (match.shapes && !match.curves) ||
    (match.distance && !match.curves) ||
    (match.hints === undefined && !match.curves)
  )
    throw new Error('Invalid node matching mode.');
  if ('artworkHints' in match) {
    if (!match.shapes || !Array.isArray(match.artworkHints) || !match.artworkHints.length)
      throw Error('Artwork hints require a shape tween and matched endpoint IDs.');
    const sources = new Set<string>(), targets = new Set<string>();
    for (const entry of match.artworkHints) {
      if (!entry || Object.keys(entry).some(k => !['sourceId','targetId','hints','contourOwners'].includes(k)) ||
          typeof entry.sourceId !== 'string' || !entry.sourceId || sources.has(entry.sourceId) ||
          typeof entry.targetId !== 'string' || !entry.targetId || targets.has(entry.targetId) ||
          (entry.hints !== null && !Array.isArray(entry.hints)))
        throw Error('Artwork hints require distinct source and target identities.');
      if ('contourOwners' in entry) {
        const owners = entry.contourOwners;
        if (!Array.isArray(owners) || !entry.hints || owners.length !== entry.hints.length)
          throw Error('Contour ownership must match the saved hint lists.');
        const used = [new Set<number>(), new Set<number>()];
        for (let i=0; i<owners.length; i++) {
          const pair = owners[i];
          if (pair === null && !entry.hints[i]?.length) continue;
          if (!entry.hints[i]?.length || !Array.isArray(pair) || pair.length !== 2 ||
              [0,1].some(side=>!Number.isSafeInteger(pair[side]) || pair[side]<0 || used[side].has(pair[side])))
            throw Error('Contour hints require distinct original ring indices.');
          used[0].add(pair[0]); used[1].add(pair[1]);
        }
      }
      sources.add(entry.sourceId); targets.add(entry.targetId);
      if (entry.hints !== null) validateMotionNodeMatching({ curves: true, hints: entry.hints });
    }
  }
  if (match.hints !== undefined) {
    if (!Array.isArray(match.hints) || !match.hints.length)
      throw new Error('Invalid node hint contours.');
    for (const pairs of match.hints) {
      if (!Array.isArray(pairs)) throw new Error('Invalid node hint contour.');
      let previous = [0, 0];
      for (const pair of pairs) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !Number.isSafeInteger(pair[0]) ||
          !Number.isSafeInteger(pair[1]) ||
          pair[0] <= previous[0] ||
          pair[1] <= previous[1]
        )
          throw new Error('Node hints must be strictly increasing interior indices.');
        previous = pair;
      }
    }
  }
}

export type MotionContourAlignment = {
  start?: number | readonly number[];
  reverse?: boolean | readonly boolean[];
  order?: readonly number[];
};
export type MotionContourCorrespondence = {
  source?: MotionContourAlignment;
  nodes?: MotionNodeMatching;
  start?: number | readonly number[];
  reverse?: boolean | readonly boolean[];
  order?: readonly number[];
};
export function validateMotionContourCorrespondence(
  value: unknown,
): asserts value is MotionContourCorrespondence {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !['start', 'reverse', 'order', 'nodes', 'source'].includes(k))
  )
    throw new Error('Invalid contour correspondence recipe.');
  const c = value as MotionContourCorrespondence;
  if (c.source !== undefined) {
    if (
      !c.source ||
      typeof c.source !== 'object' ||
      Array.isArray(c.source) ||
      Object.keys(c.source).some((k) => !['start', 'reverse', 'order'].includes(k))
    )
      throw new Error('Invalid source contour alignment.');
    validateMotionContourCorrespondence(c.source);
  }
  if (c.nodes !== undefined) validateMotionNodeMatching(c.nodes);
  if (c.start !== undefined) {
    const values = Array.isArray(c.start) ? Array.from(c.start) : [c.start];
    if (!values.length || values.some((v) => !Number.isSafeInteger(v) || v < 0))
      throw new Error('Contour start offsets must be nonnegative safe integers.');
  }
  if (c.reverse !== undefined) {
    const values = Array.isArray(c.reverse) ? Array.from(c.reverse) : [c.reverse];
    if (!values.length || values.some((v) => typeof v !== 'boolean'))
      throw new Error('Invalid contour directions.');
  }
  if (
    c.order !== undefined &&
    (!Array.isArray(c.order) ||
      !c.order.length ||
      new Set(c.order).size !== c.order.length ||
      Array.from(c.order).some((v) => !Number.isSafeInteger(v) || v < 0 || v >= c.order!.length))
  )
    throw new Error('Contour order must be a complete permutation.');
}
