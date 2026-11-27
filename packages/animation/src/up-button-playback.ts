import type { Project } from '../../document/src';
import { createInteractiveButtonView } from './movie-button-view';
import { createRootButtonMoviePlayback } from './button-preview';
import { createButtonExposureRuntime, crossedButtonEntry } from './button-exposure';

/** A playback session for the visible Up states, with independent child clocks per button exposure. */
export function createUpButtonPlayback(source: Project, layerPresentation = false) {
  const view = createInteractiveButtonView(source, { layerPresentation });
  const buttons = createRootButtonMoviePlayback();
  const exposures = createButtonExposureRuntime<string>();
  const epochs = new Map<string, number>();
  let previousPosition: number | undefined;
  return (frame: number, position: number, seconds: number, frames: Record<string, number>,
    origins: Record<string, number>, opacity?: (frame: number) => Project) => {
    const renewed = new Set<string>();
    const snapshot = view.sample(frame, frames, origins, null, null, (button, rootExposure, movieEntry) => {
      const epoch =
        button.start === 0 && button.end === source.duration
          ? 0
          : Math.floor((position - button.start) / source.duration);
      if (epochs.has(button.token) && epochs.get(button.token) !== epoch) {
        buttons.invalidate(new Set([button.token]));
        renewed.add(button.token);
      }
      epochs.set(button.token, epoch);
      const entry = rootExposure ? crossedButtonEntry(button.start, button.end, source.duration, previousPosition, position, seconds, source.fps) : movieEntry;
      const state = buttons.sample(source, [button], null, null, seconds, false, entry);
      return {
        entrySeconds: buttons.entrySeconds(button.token),
        frames: state.stateFrames.get(button.token)!,
        origins: state.stateOrigins.get(button.token)!,
      };
    });
    // Only this complete set prunes state sessions; discovery callbacks above
    // prepare individual parents without expiring their still-visible siblings.
    const visible = new Set(snapshot.buttons.map((button) => button.token));
    for (const token of epochs.keys()) if (!visible.has(token)) epochs.delete(token);
    const expired = exposures.sample(
        snapshot.buttons.map((button) => ({
          id: button.token,
          start: button.start,
          end: button.end,
        })),
        source.duration,
        position,
      );
    // Visible epochs were already renewed before child discovery.
    buttons.invalidate(new Set([...expired].filter(token => !renewed.has(token))));
    previousPosition = position;
    const bank = buttons.sample(source, snapshot.buttons, null, null, seconds);
    const painted = opacity?.(frame) ?? source;
    const paintSnapshot =
      painted === source
        ? snapshot
        : createInteractiveButtonView(painted, { layerPresentation }).sample(
            frame,
            frames,
            origins,
            null,
            null,
            (button) => ({
              frames: bank.stateFrames.get(button.token)!,
              origins: bank.stateOrigins.get(button.token)!,
            }),
          );
    return { project: painted, snapshot: paintSnapshot, artwork: painted === source ? bank.artwork : undefined, stateFrames: bank.stateFrames };
  };
}
