import { describe, expect, it } from 'vitest';
import { BATCH_USAGE, DEFAULT_SEED_COUNT, parseBatchArgs } from '../../src/runner/batch-args';
import { LAYOUT_IDS } from '../../src/shared/map';

const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('the batch command arguments', () => {
  it('runs 50 seeds on the junction layout when given nothing', () => {
    expect(DEFAULT_SEED_COUNT).toBe(50);
    expect(parseBatchArgs([])).toEqual({ seeds: upTo(50), layouts: ['junction'] });
  });

  it('takes a whole number as the number of seeds, as before', () => {
    expect(parseBatchArgs(['10'])).toEqual({ seeds: upTo(10), layouts: ['junction'] });
  });

  it.each(LAYOUT_IDS)('runs only the %s layout when asked for it', (layout) => {
    expect(parseBatchArgs([`--layout=${layout}`]).layouts).toEqual([layout]);
  });

  it('runs every layout in turn for --layout=all, simplest first', () => {
    expect(parseBatchArgs(['--layout=all']).layouts).toEqual(['branch', 'junction', 'busy', 'hub']);
  });

  it('takes the seed count and the layout in either order', () => {
    expect(parseBatchArgs(['3', '--layout=hub'])).toEqual({ seeds: [1, 2, 3], layouts: ['hub'] });
    expect(parseBatchArgs(['--layout=busy', '2'])).toEqual({ seeds: [1, 2], layouts: ['busy'] });
  });

  it('throws for a layout that does not exist instead of running the default', () => {
    expect(() => parseBatchArgs(['--layout=station'])).toThrow('unknown layout "station": it must be one of branch, junction, busy, hub, or all');
    expect(() => parseBatchArgs(['--layout='])).toThrow(/unknown layout/);
  });

  it('throws for anything else it cannot read', () => {
    expect(() => parseBatchArgs(['--layout', 'hub'])).toThrow('cannot read the argument "--layout"');
    expect(() => parseBatchArgs(['0'])).toThrow(/cannot read the argument "0"/);
    expect(() => parseBatchArgs(['2.5'])).toThrow(/cannot read the argument/);
    expect(() => parseBatchArgs(['hub'])).toThrow(/cannot read the argument "hub"/);
  });

  it('lists every layout in the usage text', () => {
    for (const layout of LAYOUT_IDS) expect(BATCH_USAGE).toContain(layout);
    expect(BATCH_USAGE).toContain('all');
  });
});
