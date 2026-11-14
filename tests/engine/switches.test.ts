import { describe, expect, it } from 'vitest';
import { ALL_ON, switchesAt, type Press } from '../../src/engine/switches';

describe('switchesAt', () => {
  const presses: Press[] = [
    { at: 60, set: { centre: false } },
    { at: 180, set: { centre: true } },
  ];

  it('starts with everything on and no radio loss', () => {
    expect(switchesAt([], 0)).toEqual(ALL_ON);
    expect(ALL_ON).toEqual({ centre: true, station: true, merge: true, sensors: true, radioDrop: 0 });
  });

  it('applies a press from its own time onward', () => {
    expect(switchesAt(presses, 59.9).centre).toBe(true);
    expect(switchesAt(presses, 60).centre).toBe(false);
    expect(switchesAt(presses, 179.9).centre).toBe(false);
    expect(switchesAt(presses, 180).centre).toBe(true);
  });

  it('applies presses in time order even if they are listed out of order', () => {
    const shuffled: Press[] = [presses[1], presses[0]];
    expect(switchesAt(shuffled, 100).centre).toBe(false);
    expect(switchesAt(shuffled, 200).centre).toBe(true);
  });

  it('leaves switches a press does not mention alone', () => {
    const s = switchesAt([{ at: 10, set: { radioDrop: 1 } }], 20);
    expect(s.radioDrop).toBe(1);
    expect(s.centre).toBe(true);
  });
});
