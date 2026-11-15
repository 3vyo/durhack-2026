import { DEFAULT_TIMETABLE } from '../engine/timetable';
import { runBatchRequest, type BatchRequest } from './run';
import { baselineProgram, ourProgram } from './programs';

// Runs the many-seed batch off the page's thread, so the demo does not freeze while the
// averages are worked out. The page sends a scenario id and its layout, and gets a
// ScenarioSummary back. A worker has its own copy of the layout in use, so the page's choice
// has to come in the message: without it the batch would run on the default layout.

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (e: { data: BatchRequest }) => void): void;
  postMessage(message: unknown): void;
};

scope.addEventListener('message', (e) => {
  const summary = runBatchRequest(
    e.data,
    SEEDS,
    { baseline: baselineProgram, ours: ourProgram },
    DEFAULT_TIMETABLE,
  );
  scope.postMessage(summary);
});
