/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTANTS, currentConstants } from '../../src/shared/constants';
import { parseParams, resetParams } from '../../src/shared/params';
import { Sim } from './harness';
import { baselineProgram } from './programs';

// Every example file in params/ must be a valid parameter file.
const files = import.meta.glob('../../params/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

afterEach(() => resetParams());

describe('the example parameter files', () => {
  it('exist', () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(5);
  });

  it.each(Object.keys(files))('%s is valid', (path) => {
    const params = parseParams(files[path]);
    expect(params.name.length).toBeGreaterThan(0);
    expect(params.runLength).toBeGreaterThan(0);
  });

  it('a run built from a file uses the file\'s timetable, failures and physics', () => {
    const params = parseParams(files['../../params/slow-heavy-trains.json']);
    const sim = Sim.fromParams(baselineProgram, params);
    expect(currentConstants().MAX_SPEED).toBe(30);
    expect(currentConstants().TRAIN_LENGTH).toBe(200);
    sim.run(600);
    expect(sim.entered.size).toBeGreaterThan(0);
    expect(sim.entered.size).toBeLessThanOrEqual(8);
    expect(Math.max(...sim.maxSpeedSeen.values())).toBeLessThanOrEqual(30 + 1e-9);
    resetParams();
    expect(currentConstants()).toEqual(DEFAULT_CONSTANTS);
  });

  it('the baseline gets every train through the slow, long-train file with no collision', () => {
    const params = parseParams(files['../../params/slow-heavy-trains.json']);
    const sim = Sim.fromParams(baselineProgram, params).run(params.runLength);
    expect(sim.incidents.filter((i) => i.kind !== 'close-call')).toEqual([]);
    expect(sim.exits.size).toBe(params.timetable.trains);
  });
});
