import { describe, expect, it } from 'vitest';
import { loadKit } from '../../src/ui/kit';

const measure = (o: string) => ({ length: o.length, width: 1, height: 2 });
const urls = { cars: ['a', 'bb', 'ccc'], rail: 'rail' };

describe('loadKit', () => {
  it('returns the cars in order with their sizes, and the rail', async () => {
    const kit = await loadKit(async (u) => `m:${u}`, measure, urls);
    expect(kit?.cars).toEqual(['m:a', 'm:bb', 'm:ccc']);
    expect(kit?.carSizes.map((s) => s.length)).toEqual([3, 4, 5]);
    expect(kit?.rail).toBe('m:rail');
  });

  it('gives null and reports once when one load fails, and never throws', async () => {
    const reports: unknown[] = [];
    const kit = await loadKit(
      async (u) => {
        if (u === 'bb') throw new Error('404');
        return u;
      },
      measure,
      urls,
      (e) => reports.push(e),
    );
    expect(kit).toBeNull();
    expect(reports).toHaveLength(1);
  });

  it('gives null with no cars', async () => {
    expect(await loadKit(async (u) => u, measure, { cars: [], rail: 'rail' })).toBeNull();
  });
});
