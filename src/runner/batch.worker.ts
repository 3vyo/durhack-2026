import { DEFAULT_TIMETABLE } from '../engine/timetable';
import { SCENARIOS, type ScenarioId } from '../scenarios/scenarios';
import { runBatch } from './run';
import { baselineProgram, ourProgram } from './programs';

// Runs the many-seed batch off the page's thread, so the demo does not freeze while the
// averages are worked out. The page sends a scenario id and gets a ScenarioSummary back.

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (e: { data: { scenario: ScenarioId } }) => void): void;
  postMessage(message: unknown): void;
};

scope.addEventListener('message', (e) => {
  const summary = runBatch(
    SCENARIOS[e.data.scenario],
    SEEDS,
    { baseline: baselineProgram, ours: ourProgram },
    DEFAULT_TIMETABLE,
  );
  scope.postMessage(summary);
});
