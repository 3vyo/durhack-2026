import { describe, expect, it } from 'vitest';
import { consistLayout, disposeAll, trainIdOf, type Pickable } from '../../src/ui/consist';

describe('consistLayout', () => {
  it('fits the three-car subway unit to a 100 m train, 8 units', () => {
    const { scale, centres } = consistLayout([2.6, 2.6, 2.6], 8, 0.12);
    expect(scale).toBeCloseTo(0.995, 3);
    expect(centres[0]).toBeCloseTo(2.71, 2);
    expect(centres[1]).toBeCloseTo(0, 9);
    expect(centres[2]).toBeCloseTo(-2.71, 2);
  });

  it('puts the nose at the front and handles unequal cars', () => {
    const { scale, centres } = consistLayout([2.8, 2.6, 2.6], 50);
    expect(scale).toBeCloseTo(6.25, 9);
    expect(centres[0]).toBeCloseTo(16.25, 9);
    expect(centres[1]).toBeCloseTo(-0.625, 9);
    expect(centres[2]).toBeCloseTo(-16.875, 9);
  });

  it('counts the gaps in the length', () => {
    const { scale, centres } = consistLayout([2, 2], 10, 1);
    expect(scale).toBe(2);
    expect(centres).toEqual([3, -3]);
  });

  it('refuses a train with no cars', () => {
    expect(() => consistLayout([], 50)).toThrow('at least one car');
  });
});

describe('trainIdOf', () => {
  const node = (trainId: number | undefined, parent: Pickable | null): Pickable => ({ userData: trainId === undefined ? {} : { trainId }, parent });

  it('finds the id on a parent, however deep', () => {
    const train = node(7, null);
    expect(trainIdOf(node(undefined, node(undefined, node(undefined, train))))).toBe(7);
  });

  it('gives null with no id anywhere, and the nearest id when two nest', () => {
    expect(trainIdOf(node(undefined, node(undefined, null)))).toBeNull();
    expect(trainIdOf(node(undefined, node(3, node(9, null))))).toBe(3);
    expect(trainIdOf(null)).toBeNull();
  });
});

describe('disposeAll', () => {
  it('disposes each item once and counts them', () => {
    const calls: number[] = [];
    const items = [1, 2, 3].map((n) => ({ dispose: () => calls.push(n) }));
    expect(disposeAll(items)).toBe(3);
    expect(calls).toEqual([1, 2, 3]);
    expect(disposeAll([])).toBe(0);
  });
});
