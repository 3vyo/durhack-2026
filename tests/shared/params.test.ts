import { afterEach, describe, expect, it } from 'vitest';
import * as constants from '../../src/shared/constants';
import { BRAKE, DEFAULT_CONSTANTS, MAX_SPEED, SIGHT_SPEED, TICK, currentConstants, resetConstants, safeSpeed, setConstants } from '../../src/shared/constants';
import { DEFAULT_PARAMS, ParamsError, applyParams, constantsFor, defaultSightSpeed, parseParams, resetParams } from '../../src/shared/params';

afterEach(() => resetParams());

function problemsOf(input: unknown): string[] {
  try {
    parseParams(input);
  } catch (e) {
    if (e instanceof ParamsError) return e.problems;
    throw e;
  }
  return [];
}

describe('constants that a parameter file can change', () => {
  it('start at the values in docs/design.md', () => {
    expect(currentConstants()).toEqual(DEFAULT_CONSTANTS);
    expect(DEFAULT_CONSTANTS.MAX_SPEED).toBe(45);
    expect(DEFAULT_CONSTANTS.SIGHT_SPEED).toBe(21);
    expect(DEFAULT_CONSTANTS.TICK).toBe(0.1);
  });

  it('show their new value to a file that already imported them', () => {
    setConstants({ MAX_SPEED: 30, SIGHT_SPEED: 10, TICK: 0.2 });
    expect(MAX_SPEED).toBe(30);
    expect(SIGHT_SPEED).toBe(10);
    expect(TICK).toBe(0.2);
    expect(constants.MAX_SPEED).toBe(30);
  });

  it('change what safeSpeed returns when BRAKE changes', () => {
    const before = safeSpeed(250);
    setConstants({ BRAKE: BRAKE * 4 });
    expect(safeSpeed(250)).toBeCloseTo(before * 2, 9);
  });

  it('leave the constants it was not given alone', () => {
    setConstants({ MAX_SPEED: 30 });
    expect(currentConstants()).toEqual({ ...DEFAULT_CONSTANTS, MAX_SPEED: 30 });
  });

  it('go back to the design values on reset', () => {
    setConstants({ MAX_SPEED: 30, MERGE_TIMEOUT: 99 });
    resetConstants();
    expect(currentConstants()).toEqual(DEFAULT_CONSTANTS);
    expect(MAX_SPEED).toBe(45);
  });

  it('cannot change the frozen defaults', () => {
    expect(Object.isFrozen(DEFAULT_CONSTANTS)).toBe(true);
  });
});

describe('the default parameters', () => {
  it('stand for exactly the constants in docs/design.md', () => {
    expect(constantsFor(DEFAULT_PARAMS)).toEqual(DEFAULT_CONSTANTS);
  });

  it('are what an empty file gives', () => {
    expect(parseParams({})).toEqual(DEFAULT_PARAMS);
  });

  it('pass their own checks', () => {
    expect(problemsOf(JSON.parse(JSON.stringify(DEFAULT_PARAMS)))).toEqual([]);
  });

  it('start with everything switched on and no failures', () => {
    expect(DEFAULT_PARAMS.start).toEqual({ centre: true, station: true, merge: true, sensors: true, radioDrop: 0 });
    expect(DEFAULT_PARAMS.failures).toEqual([]);
  });
});

describe('reading a parameter file', () => {
  it('keeps the default for anything the file leaves out', () => {
    const p = parseParams({ physics: { maxSpeed: 30 }, timetable: { trains: 4 } });
    expect(p.physics).toEqual({ ...DEFAULT_PARAMS.physics, maxSpeed: 30 });
    expect(p.timetable).toEqual({ ...DEFAULT_PARAMS.timetable, trains: 4 });
    expect(p.timers).toEqual(DEFAULT_PARAMS.timers);
  });

  it('reads the name and the run length', () => {
    const p = parseParams({ name: 'centre outage', runLength: 1200 });
    expect(p.name).toBe('centre outage');
    expect(p.runLength).toBe(1200);
  });

  it('works out sightSpeed from the other physics values when the file leaves it out', () => {
    const p = parseParams({ physics: { sensorRange: 500 } });
    expect(p.physics.sightSpeed).toBe(defaultSightSpeed(0.9, 500, 50));
    expect(p.physics.sightSpeed).toBe(28);
  });

  it('keeps the design sightSpeed when the file has no physics section', () => {
    expect(parseParams({ timers: { mergeTimeout: 20 } }).physics.sightSpeed).toBe(21);
  });

  it('reads failures and puts them in time order', () => {
    const p = parseParams({
      failures: [
        { at: 180, centre: true },
        { at: 60, centre: false },
        { at: 90, breakDown: 3 },
      ],
    });
    expect(p.failures).toEqual([
      { at: 60, centre: false },
      { at: 90, breakDown: 3 },
      { at: 180, centre: true },
    ]);
  });

  it('does not change the defaults or the input', () => {
    const input = { physics: { maxSpeed: 30 }, failures: [{ at: 5, merge: false }] };
    const copy = JSON.parse(JSON.stringify(input));
    parseParams(input);
    expect(input).toEqual(copy);
    expect(DEFAULT_PARAMS.physics.maxSpeed).toBe(45);
  });
});

describe('a parameter file with mistakes', () => {
  it('must hold one object', () => {
    expect(problemsOf([])).toEqual(['the file must hold one JSON object']);
    expect(problemsOf('x')).toEqual(['the file must hold one JSON object']);
    expect(problemsOf(null)).toEqual(['the file must hold one JSON object']);
  });

  it('names a section it does not know', () => {
    expect(problemsOf({ phisics: {} })[0]).toContain('phisics is not a known section');
  });

  it('names a setting it does not know, and lists the ones it does', () => {
    const [problem] = problemsOf({ physics: { maxSped: 30 } });
    expect(problem).toContain('physics.maxSped is not a known setting');
    expect(problem).toContain('maxSpeed');
  });

  it('rejects a value of the wrong type', () => {
    expect(problemsOf({ physics: { maxSpeed: '45' } })[0]).toContain('physics.maxSpeed must be a number, but is "45"');
    expect(problemsOf({ start: { centre: 'off' } })[0]).toContain('start.centre must be a boolean');
    expect(problemsOf({ name: 7 })[0]).toContain('name must be a string');
  });

  it('rejects zero and negative physics and timer values', () => {
    expect(problemsOf({ physics: { brake: 0 } }).join('\n')).toContain('physics.brake must be more than 0');
    expect(problemsOf({ timers: { mergeTimeout: -1 } }).join('\n')).toContain('timers.mergeTimeout must be more than 0');
  });

  it('rejects a sight speed that cannot stop within what the train sees', () => {
    const problems = problemsOf({ physics: { sightSpeed: 30 } });
    expect(problems.join('\n')).toContain('physics.sightSpeed (30) is too fast to stop within sensorRange - margin');
  });

  it('rejects a margin as long as the sensor range', () => {
    expect(problemsOf({ physics: { margin: 300 } }).join('\n')).toContain('physics.margin (300) must be less than physics.sensorRange (300)');
  });

  it('rejects a sight speed above the top speed', () => {
    expect(problemsOf({ physics: { maxSpeed: 15 } }).join('\n')).toContain('physics.sightSpeed (21) must not be more than physics.maxSpeed (15)');
  });

  it('rejects timers that cannot work together', () => {
    expect(problemsOf({ timers: { permitFresh: 1 } }).join('\n')).toContain('timers.permitFresh (1) must be longer than timers.permitInterval (1)');
    expect(problemsOf({ timers: { mergeTimeout: 2 } }).join('\n')).toContain('timers.mergeTimeout (2) must be longer than timers.requestRepeat (2)');
    expect(problemsOf({ timers: { stationTimeout: 1 } }).join('\n')).toContain('timers.stationTimeout (1) must be longer than timers.requestRepeat (2)');
    expect(problemsOf({ timers: { resumeSettle: 2 } }).join('\n')).toContain('timers.resumeSettle (2) must be at least');
    expect(problemsOf({ timers: { slotWindow: 90 } }).join('\n')).toContain('timers.slotWindow (90) must not be longer than timers.slotLength (60)');
    expect(problemsOf({ timers: { requestRepeat: 0.05 } }).join('\n')).toContain('timers.requestRepeat (0.05) must not be shorter than physics.tick (0.1)');
  });

  it('rejects a timetable with no trains or a fraction of a train', () => {
    expect(problemsOf({ timetable: { trains: 0 } }).join('\n')).toContain('timetable.trains must be a whole number of at least 1');
    expect(problemsOf({ timetable: { trains: 2.5 } }).join('\n')).toContain('timetable.trains must be a whole number of at least 1');
  });

  it('rejects a radio loss outside 0 to 1', () => {
    expect(problemsOf({ start: { radioDrop: 1.5 } }).join('\n')).toContain('start.radioDrop must be between 0 and 1');
    expect(problemsOf({ failures: [{ at: 10, radioDrop: -0.1 }] }).join('\n')).toContain('failures[0].radioDrop must be between 0 and 1');
  });

  it('rejects a failure with no time, no effect, a bad setting or a train that does not exist', () => {
    expect(problemsOf({ failures: [{ centre: false }] }).join('\n')).toContain('failures[0].at is missing');
    expect(problemsOf({ failures: [{ at: 10 }] }).join('\n')).toContain('failures[0] changes nothing');
    expect(problemsOf({ failures: [{ at: 10, center: false }] }).join('\n')).toContain('failures[0].center is not a known setting');
    expect(problemsOf({ failures: [{ at: -5, merge: false }] }).join('\n')).toContain('failures[0].at must not be negative');
    expect(problemsOf({ failures: [{ at: 10, breakDown: 99 }] }).join('\n')).toContain('failures[0].breakDown must be a train number from 1 to 12');
    expect(problemsOf({ failures: 'none' })).toEqual(['failures must be a list']);
  });

  it('lists every problem at once, in one error message', () => {
    const problems = problemsOf({ physics: { maxSped: 1, brake: -1 }, timetable: { trains: 0 }, bogus: 1 });
    expect(problems.length).toBe(4);
    expect(() => parseParams({ bogus: 1, timetable: { trains: 0 } })).toThrow(/has 2 problems:\n- /);
  });
});

describe('applying parameters', () => {
  it('makes the constants hold the values from the file', () => {
    applyParams(parseParams({ physics: { maxSpeed: 30, sightSpeed: 12 }, timers: { mergeTimeout: 20, slotCount: 2 } }));
    expect(MAX_SPEED).toBe(30);
    expect(SIGHT_SPEED).toBe(12);
    expect(constants.MERGE_TIMEOUT).toBe(20);
    expect(constants.SLOT_COUNT).toBe(2);
    expect(constants.ACCEL).toBe(0.5);
  });

  it('goes back to the design values on reset', () => {
    applyParams(parseParams({ physics: { maxSpeed: 30 } }));
    resetParams();
    expect(currentConstants()).toEqual(DEFAULT_CONSTANTS);
  });
});
