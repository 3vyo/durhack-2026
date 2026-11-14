import { describe, expect, it } from 'vitest';
import { ALL_ON } from '../../src/engine/switches';
import { batchRunsText, radioLabel, switchesLine, switchLabel, trainChoices } from '../../src/ui/controls';

describe('switchLabel', () => {
  it('names the switch and says whether it is on', () => {
    expect(switchLabel('centre', true)).toBe('Control centre: ON');
    expect(switchLabel('platformKeeper', false)).toBe('Platform keeper: OFF');
    expect(switchLabel('junctionKeeper', true)).toBe('Junction keeper: ON');
    expect(switchLabel('sensors', false)).toBe('Platform sensors: OFF');
  });
});

describe('radioLabel', () => {
  it('shows the share of dropped messages as a whole percentage', () => {
    expect(radioLabel(0)).toBe('Radio loss: 0%');
    expect(radioLabel(0.4)).toBe('Radio loss: 40%');
    expect(radioLabel(1)).toBe('Radio loss: 100%');
  });
});

describe('switchesLine', () => {
  it('shows every switch, not just the centre and the radio', () => {
    expect(switchesLine(ALL_ON)).toBe(
      'Control centre: ON  |  Radio loss: 0%  |  Platform keeper: ON  |  Junction keeper: ON  |  Platform sensors: ON',
    );
  });

  it('shows switches that are off', () => {
    const line = switchesLine({ ...ALL_ON, junctionKeeper: false, sensors: false, radioDrop: 0.25 });
    expect(line).toContain('Junction keeper: OFF');
    expect(line).toContain('Platform sensors: OFF');
    expect(line).toContain('Radio loss: 25%');
    expect(line).toContain('Platform keeper: ON');
  });
});

describe('trainChoices', () => {
  it('lists each train on either map once, lowest first', () => {
    expect(trainChoices([{ id: 7 }, { id: 2 }], [{ id: 2 }, { id: 9 }])).toEqual([2, 7, 9]);
  });

  it('is empty when no train is on either map', () => {
    expect(trainChoices([], [])).toEqual([]);
  });
});

describe('batchRunsText', () => {
  it('names the scripted failure and its length', () => {
    expect(batchRunsText({ scenario: 'centre-outage', seeds: 50 })).toBe('50 runs with a scripted 2 min centre outage');
  });

  it('says nothing fails in the healthy scenario', () => {
    expect(batchRunsText({ scenario: 'healthy', seeds: 10 })).toBe('10 runs with nothing failing');
  });
});
