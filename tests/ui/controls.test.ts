import { afterEach, describe, expect, it } from 'vitest';
import { ALL_ON } from '../../src/engine/switches';
import { LAYOUT_IDS, LAYOUTS, applyLayout, resetLayout } from '../../src/shared/map';
import {
  batchRunsText,
  entryLines,
  keepLayoutShown,
  layoutUrl,
  parseLayout,
  radioLabel,
  spawnNote,
  statusTitle,
  switchesLine,
  switchLabel,
  trainChoices,
} from '../../src/ui/controls';

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

describe('statusTitle', () => {
  const on = { centre: true, platformKeeper: true, junctionKeeper: true, sensors: true, radioDrop: 0 };

  it('says all is well when nothing is failing', () => {
    expect(statusTitle(on)).toBe('All systems working');
  });

  it('names what is down, joined in plain English', () => {
    expect(statusTitle({ ...on, centre: false })).toBe('Control centre down');
    expect(statusTitle({ ...on, centre: false, radioDrop: 1 })).toBe('Control centre and radio down');
    expect(statusTitle({ ...on, centre: false, platformKeeper: false, junctionKeeper: false })).toBe(
      'Control centre, platform keeper and junction keeper down',
    );
  });

  it('gives partial radio loss as a share', () => {
    expect(statusTitle({ ...on, radioDrop: 0.4 })).toBe('Radio losing 40%');
    expect(statusTitle({ ...on, sensors: false, radioDrop: 0.25 })).toBe('Platform sensors down, radio losing 25%');
  });
});

describe('spawnNote', () => {
  it('names the new train and its line', () => {
    expect(spawnNote(17, 'A')).toBe('Train 17 joins line A');
    expect(spawnNote(3, 'B')).toBe('Train 3 joins line B');
  });

  it('offers both entry lines, A first', () => {
    expect(entryLines()).toEqual(['A', 'B']);
  });

  it('names a train on a line only the bigger layouts have', () => {
    expect(spawnNote(21, 'D')).toBe('Train 21 joins line D');
  });
});

describe('entryLines', () => {
  afterEach(() => resetLayout());

  it('offers the entry lines of the layout in use, in order', () => {
    applyLayout('branch');
    expect(entryLines()).toEqual(['A']);
    applyLayout('junction');
    expect(entryLines()).toEqual(['A', 'B']);
    applyLayout('busy');
    expect(entryLines()).toEqual(['A', 'B', 'C']);
    applyLayout('hub');
    expect(entryLines()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('matches the layout table for every layout', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      expect(entryLines()).toEqual([...LAYOUTS[id].entries]);
    }
  });

  it('gives a fresh list each time, so a caller cannot change the layout through it', () => {
    applyLayout('hub');
    entryLines().pop();
    expect(entryLines()).toHaveLength(4);
  });
});

describe('parseLayout', () => {
  it('reads the layout named in the page address', () => {
    expect(parseLayout('?layout=hub')).toBe('hub');
    expect(parseLayout('?layout=branch')).toBe('branch');
    expect(parseLayout('?check=1&layout=busy&quality=low')).toBe('busy');
    expect(parseLayout('?layout=junction')).toBe('junction');
  });

  it('falls back to the default layout when none is named', () => {
    expect(parseLayout('')).toBe('junction');
    expect(parseLayout('?quality=low')).toBe('junction');
  });

  it('falls back to the default layout when the name is not a layout', () => {
    expect(parseLayout('?layout=terminus')).toBe('junction');
    expect(parseLayout('?layout=')).toBe('junction');
    expect(parseLayout('?layout=HUB')).toBe('junction');
  });
});

describe('layoutUrl', () => {
  it('adds the layout to an address that has no parameters', () => {
    expect(layoutUrl('http://localhost:5173/', 'hub')).toBe('http://localhost:5173/?layout=hub');
  });

  it('replaces the layout already in the address', () => {
    expect(layoutUrl('http://localhost:5173/?layout=branch', 'busy')).toBe('http://localhost:5173/?layout=busy');
  });

  it('keeps every other parameter', () => {
    const url = new URL(layoutUrl('http://localhost:5173/demo/?check=1&quality=low&layout=junction', 'hub'));
    expect(url.pathname).toBe('/demo/');
    expect(url.searchParams.get('check')).toBe('1');
    expect(url.searchParams.get('quality')).toBe('low');
    expect(url.searchParams.getAll('layout')).toEqual(['hub']);
  });

  it('keeps a parameter that has no value, such as ?check', () => {
    const url = new URL(layoutUrl('http://localhost:5173/?check', 'branch'));
    expect(url.searchParams.has('check')).toBe(true);
    expect(url.searchParams.get('layout')).toBe('branch');
  });

  it('gives an address that parseLayout reads back', () => {
    for (const id of LAYOUT_IDS) expect(parseLayout(new URL(layoutUrl('http://localhost:5173/?quality=low', id)).search)).toBe(id);
  });
});

describe('keepLayoutShown', () => {
  afterEach(() => resetLayout());

  /** A stand-in for the Layout list and the window: the list, and a way to show the page again. */
  function page(value = '') {
    const list = { value, autocomplete: '' };
    const shown: Array<() => void> = [];
    const win = { addEventListener: (type: 'pageshow', listener: () => void) => void (type === 'pageshow' && shown.push(listener)) };
    return { list, win, showAgain: () => shown.forEach((listener) => listener()) };
  }

  it('shows the layout in use when the page is built', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const { list, win } = page();
      keepLayoutShown(list, win);
      expect(list.value).toBe(id);
    }
  });

  it("shows the layout in use again after the browser's Back button brings the page back", () => {
    // The page runs the default layout. Hub is picked, the page is left, and Back returns to it
    // with Hub still selected.
    const { list, win, showAgain } = page();
    keepLayoutShown(list, win);
    list.value = 'hub';
    showAgain();
    expect(list.value).toBe('junction');
  });

  it('does the same on every layout, each time the page is shown', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      const { list, win, showAgain } = page();
      keepLayoutShown(list, win);
      for (const other of LAYOUT_IDS) {
        list.value = other;
        showAgain();
        expect(list.value).toBe(id);
      }
    }
  });

  it('tells the browser not to put an old choice back when it loads the page again', () => {
    const { list, win } = page();
    keepLayoutShown(list, win);
    expect(list.autocomplete).toBe('off');
  });
});
