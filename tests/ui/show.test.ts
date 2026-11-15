import { describe, expect, it } from 'vitest';
import { LINK_KINDS } from '../../src/ui/links';
import { SHOW_ALL, SHOW_ITEMS, kindShown, parseShow, toggleAll } from '../../src/ui/show';

describe('Show', () => {
  it('puts every line kind under exactly one menu item', () => {
    for (const kind of LINK_KINDS) expect(SHOW_ITEMS.filter((i) => i.kinds.includes(kind))).toHaveLength(1);
  });

  it('has a menu item for every setting', () => {
    expect(SHOW_ITEMS.map((i) => i.key).sort()).toEqual(Object.keys(SHOW_ALL).sort());
  });

  it('hides a line kind when its item is off, and only that item', () => {
    expect(kindShown('grant', SHOW_ALL)).toBe(true);
    const noKeepers = { ...SHOW_ALL, keepers: false };
    expect(kindShown('grant', noKeepers)).toBe(false);
    expect(kindShown('asking', noKeepers)).toBe(false);
    expect(kindShown('permit', noKeepers)).toBe(true);
    expect(kindShown('staff', { ...SHOW_ALL, permits: false })).toBe(false);
  });

  it('turns everything off if anything is on, and everything on if nothing is', () => {
    const someOn = toggleAll({ ...SHOW_ALL, cones: false });
    expect(Object.values(someOn).every((v) => v === false)).toBe(true);
    expect(toggleAll(someOn)).toEqual(SHOW_ALL);
  });

  it('reads a saved choice, and falls back to on for anything missing or broken', () => {
    expect(parseShow(JSON.stringify({ ...SHOW_ALL, tint: false }))).toEqual({ ...SHOW_ALL, tint: false });
    expect(parseShow(JSON.stringify({ cones: false, made: 'up', leader: 'no' }))).toEqual({ ...SHOW_ALL, cones: false });
    expect(parseShow('not json')).toEqual(SHOW_ALL);
    expect(parseShow(null)).toEqual(SHOW_ALL);
  });
});
