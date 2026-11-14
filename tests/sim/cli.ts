// Run the simulation from a parameter file and print what happened.
//
//   npm run sim -- params/centre-outage.json
//   npm run sim -- params/*.json
//
// Each file is run twice, once with our program and once with the baseline, on the same
// timetable and the same failures. Delay is measured against the baseline with nothing
// failed. This uses the test simulation in harness.ts, not the demo engine.

// @ts-expect-error Node's own types are not installed. This file only runs under vite-node.
import { readFileSync } from 'node:fs';
import type { TrainProgram } from '../../src/engine/ports';
import { ParamsError, parseParams, resetParams } from '../../src/shared/params';
import type { SimParams } from '../../src/shared/params';
import { Sim } from './harness';
import { baselineProgram, ourProgram } from './programs';

declare const process: { argv: string[]; exitCode?: number };

interface Result {
  through: number;
  trains: number;
  delay: number;
  lastExit: number | null;
  collisions: number;
  overruns: number;
  closeCalls: number;
}

function runOnce(program: TrainProgram, params: SimParams): Sim {
  const sim = Sim.fromParams(program, params).run(params.runLength);
  resetParams();
  return sim;
}

function measure(sim: Sim, reference: Sim, params: SimParams): Result {
  let delay = 0;
  let lastExit: number | null = null;
  for (let id = 1; id <= params.timetable.trains; id++) {
    const exit = sim.exits.get(id);
    const ref = reference.exits.get(id) ?? params.runLength;
    delay += Math.max(0, (exit ?? params.runLength) - ref);
    if (exit !== undefined) lastExit = Math.max(lastExit ?? 0, exit);
  }
  return {
    through: sim.exits.size,
    trains: params.timetable.trains,
    delay,
    lastExit,
    collisions: sim.collisions,
    overruns: sim.overruns,
    closeCalls: sim.closeCalls,
  };
}

function row(label: string, r: Result): string {
  const cells = [
    label.padEnd(9),
    `${r.through}/${r.trains}`.padStart(7),
    `${(r.delay / 60).toFixed(1)} min`.padStart(12),
    (r.lastExit === null ? 'none' : `${r.lastExit.toFixed(0)} s`).padStart(10),
    String(r.collisions).padStart(10),
    String(r.overruns).padStart(8),
    String(r.closeCalls).padStart(11),
  ];
  return cells.join('  ');
}

function runFile(path: string): boolean {
  let params: SimParams;
  try {
    params = parseParams(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    console.log(`\n${path}`);
    console.log(e instanceof ParamsError ? e.message : `Could not read the file: ${String(e)}`);
    return false;
  }
  // The reference: the baseline on the same timetable with nothing failed.
  const healthy: SimParams = { ...params, start: { centre: true, station: true, merge: true, sensors: true, radioDrop: 0 }, failures: [] };
  const reference = runOnce(baselineProgram, healthy);
  const ours = runOnce(ourProgram, params);
  const baseline = runOnce(baselineProgram, params);

  console.log(`\n${path}: ${params.name}`);
  console.log(`  ${params.timetable.trains} trains, seed ${params.timetable.seed}, ${params.failures.length} failure event(s), run length ${params.runLength} s`);
  console.log(`  ${['program'.padEnd(9), 'through'.padStart(7), 'total delay'.padStart(12), 'last exit'.padStart(10), 'collisions'.padStart(10), 'overruns'.padStart(8), 'close calls'.padStart(11)].join('  ')}`);
  console.log(`  ${row('ours', measure(ours, reference, params))}`);
  console.log(`  ${row('baseline', measure(baseline, reference, params))}`);
  for (const sim of [ours, baseline]) {
    for (const i of sim.incidents.filter((x) => x.kind !== 'close-call').slice(0, 5)) {
      console.log(`  ! ${sim === ours ? 'ours' : 'baseline'}: ${i.kind} at ${i.at.toFixed(1)} s: ${i.detail}`);
    }
  }
  return ours.collisions === 0 && ours.overruns === 0;
}

const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
if (files.length === 0) {
  console.log('Usage: npm run sim -- <parameter file.json> [more files]\nExample files are in params/.');
  process.exitCode = 1;
} else {
  const ok = files.map(runFile).every(Boolean);
  if (!ok) process.exitCode = 1;
}
