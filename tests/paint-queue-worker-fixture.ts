import floating from 'polygon-clipping';
import '../packages/geometry/src/worker';

// Test-only worker: run the real geometry transaction while the floating kernel
// reports the user's exact queue failure. No production test hooks are exposed.
for (const op of ['union', 'difference', 'intersection', 'xor'] as const) {
  floating[op] = () => {
    self.postMessage({ queueFault: true, operation: op });
    throw new Error(
      'Unable to pop() left SweepEvent [66.44871739195302, 334.9944499599596] from segment #2996 [66.44871739195302, 334.9944499599596] -> [66.44883787083073, 334.99474973631874] from queue.',
    );
  };
}
