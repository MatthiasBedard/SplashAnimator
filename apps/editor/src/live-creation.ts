import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { qualifyLiveGraphicMotion } from '../../../packages/animation/src/live-graphics';
import { qualifyLiveMovieMotion } from '../../../packages/animation/src/live-movies';
import { qualifyLiveMovieTreeMotion } from '../../../packages/animation/src/live-movie-trees';
import type { Project, MotionSpanOptions } from '../../../packages/document/src';
import type { MotionRotation } from '../../../packages/document/src/motion-rotation';
import type { MotionEase } from '../../../packages/document/src/motion-ease';

type GroupScaleOptions = Pick<MotionRotation, 'uniformGroupScale' | 'axisGroupScale' | 'axisGroupShear'>;
export function graphicGroupOptions(mode: string, scaling: GroupScaleOptions = {}, nestedMovies = false, movieMembers = false) {
  if (mode !== 'group-graphics' && mode !== 'group-graphic-orbit') return undefined;
  return {
    symbolContinuity: 'graphics' as const,
    ...(mode === 'group-graphic-orbit' && nestedMovies ? {nestedGraphicMovies:movieMembers ? 'members-and-descendants' as const : true as const} : {}),
    rotation: {
      direction: 'shortest' as const, turns: 0, rigidGroups: true,
      ...(mode === 'group-graphic-orbit' ? { savedGroupPivots: true, ...scaling } : {}),
    },
  };
}

export type LiveCreationInput = {
  start: number;
  end: number;
  tracks: readonly string[];
  ease: MotionEase;
  options?: MotionSpanOptions;
  rotation?: MotionRotation;
  nestedGraphicMovies?: true | 'members-and-descendants';
  symbolContinuity?: 'graphics' | 'movies' | 'movie-trees';
};
/** Original-snapshot availability hints only. The shared live kernel, original
 * source/input admission and complete candidate validation authorize creation. */
export function liveCreationIssue(
  project: Project,
  id: string,
  start: number,
  end: number,
  mode: 'plain' | 'groups' | 'group-graphics' | 'group-graphic-orbit' | 'graphics' | 'movies' | 'movie-trees' = 'plain',
  scaling: GroupScaleOptions = {},
  affine = false,
  nestedMovies = false,
  movieMembers = false,
) {
  if (!['plain', 'groups', 'group-graphics', 'group-graphic-orbit', 'graphics', 'movies', 'movie-trees'].includes(mode))
    return 'Choose a supported live motion mode.';
  if (mode === 'group-graphic-orbit' || mode === 'group-graphics' || mode === 'graphics' || mode === 'movies' || mode === 'movie-trees') {
    try {
      validateLiveGraphicData(project);
    } catch (cause) {
      return String(cause);
    }
  }
  const layer = project.layers.find((l) => l.id === id);
  if (!layer || !layer.visible || layer.locked) return 'Requires a visible, unlocked root layer.';
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end - start < 2 ||
    end >= project.duration
  )
    return 'Choose exact endpoint frames at least two frames apart.';
  const a = layer.keys.find((k) => k.frame === start),
    b = layer.keys.find((k) => k.frame === end);
  if (!a?.shapes.length || !b?.shapes.length)
    return 'Both endpoints must be existing nonempty keys.';
  if (layer.keys.some((k) => k.frame > start && k.frame < end))
    return 'Authored interior keys must remain untouched.';
  if (mode === 'plain') {
    if ([a, b].some((k) => k.shapes.some((s) => s.kind === 'symbol' || s.groups?.length)))
      return 'Symbol and grouped endpoints require separate live support.';
  } else if (mode === 'groups' || mode === 'group-graphics' || mode === 'group-graphic-orbit') {
    if (mode==='groups' && [a, b].some((k) => k.shapes.some((s) => s.kind === 'symbol')))
      return 'Symbol endpoints require separate live support.';
    if (
      a.shapes.length !== b.shapes.length ||
      a.shapes.some((s, i) => {
        const other = b.shapes[i];
        return (
          s.id !== other.id ||
          (s.groups?.length ?? 0) !== (other.groups?.length ?? 0) ||
          s.groups?.some((group, index) => group !== other.groups?.[index])
        );
      })
    )
      return 'Complete groups require unchanged ordered artwork IDs and ancestry at both endpoints.';
    const groups = new Map<string, number>();
    for (const shape of a.shapes)
      if (shape.groups?.length) groups.set(shape.groups[0], (groups.get(shape.groups[0]) ?? 0) + 1);
    if (!groups.size || [...groups.values()].some((count) => count < 2))
      return 'Choose complete outer groups with at least two members each.';
  }
  if (mode === 'group-graphic-orbit' || mode === 'group-graphics' || mode === 'graphics' || mode === 'movies' || mode === 'movie-trees') {
    try {
      (mode === 'movie-trees'
        ? qualifyLiveMovieTreeMotion
        : mode === 'movies'
          ? qualifyLiveMovieMotion
          : qualifyLiveGraphicMotion)(project, id, {
        start,
        end,
        ease: 'linear',
        ...(affine ? { options: { affine } } : {}),
        ...(mode === 'group-graphics' || mode === 'group-graphic-orbit' ? graphicGroupOptions(mode, scaling, nestedMovies, movieMembers) : { symbolContinuity: mode }),
      });
    } catch (cause) {
      return String(cause);
    }
  }
  if (
    [...(layer.liveMotionSpans ?? []), ...(layer.motionSpans ?? [])].some(
      (s) => s.start < end && s.end > start,
    )
  )
    return 'Existing tween ownership overlaps this range.';
  if (project.opacityBindings?.some((b) => b.layerId === id && b.start < end && b.end > start))
    return 'Existing opacity ownership overlaps this range.';
}
