import { describe, expect, it } from 'vitest';
import type { TrainView, TracksideView } from '../../src/engine/engine';
import { LINK_KINDS, LINK_STYLE, linksFor } from '../../src/ui/links';

const quiet: TracksideView = {
  platformKeeper: null,
  junctionKeeper: null,
  sensorsAge: null,
  askedPlatformKeeper: null,
  askedJunctionKeeper: null,
};

function view(over: Omit<Partial<TrainView>, 'trackside'> & { trackside?: Partial<TracksideView> } = {}): TrainView {
  const { trackside, ...rest } = over;
  return {
    id: 4,
    pos: { track: 'A', offset: 5000 },
    x: 5000,
    speed: 20,
    mode: 'full',
    leaderId: null,
    leaderAge: null,
    permitAge: null,
    lastGrants: { platform: null, junction: false },
    ...rest,
    trackside: { ...quiet, ...trackside },
  };
}

const kinds = (v: TrainView, program: 'baseline' | 'ours' = 'ours') => linksFor(v, program).map((l) => l.kind);

describe('linksFor', () => {
  it('draws only the permit for a train obeying the centre, from the centre to the train', () => {
    const links = linksFor(view({ mode: 'central', permitAge: 0.3, leaderId: 3, leaderAge: 0.2 }), 'ours');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'permit', from: { device: 'centre' }, to: { train: 4 } });
    expect(links[0].note).toBeUndefined();
  });

  it('fades the permit line and counts down once the permits stop', () => {
    const fresh = linksFor(view({ mode: 'central', permitAge: 0.2 }), 'ours')[0];
    const late = linksFor(view({ mode: 'central', permitAge: 3.4 }), 'ours')[0];
    expect(late.strength).toBeLessThan(fresh.strength);
    expect(late.note).toBe('No permit for 3 s. At 5 s it switches to its own rules');
    expect(linksFor(view({ mode: 'central', permitAge: 3.4 }), 'baseline')[0].note).toBe('No permit for 3 s. At 5 s it stops');
  });

  it('draws a radio working permit in its own kind', () => {
    expect(kinds(view({ mode: 'radio', permitAge: 0.5 }), 'baseline')).toEqual(['staff']);
  });

  it('draws nothing for a baseline train without a fresh permit', () => {
    expect(kinds(view({ mode: 'blind', leaderId: 3, leaderAge: 0.5, trackside: { sensorsAge: 0.2 } }), 'baseline')).toEqual([]);
  });

  it('draws the train ahead, from that train, and fainter once its report is stale', () => {
    const fresh = linksFor(view({ leaderId: 3, leaderAge: 0.5 }), 'ours');
    expect(fresh).toEqual([expect.objectContaining({ kind: 'leader', from: { train: 3 }, to: { train: 4 } })]);
    const stale = linksFor(view({ mode: 'stale', leaderId: 3, leaderAge: 9 }), 'ours')[0];
    expect(stale.strength).toBeLessThan(fresh[0].strength);
  });

  it('draws no leader line for a train that has not heard its leader or does not know it', () => {
    expect(kinds(view({ leaderId: 3, leaderAge: null }))).toEqual([]);
    expect(kinds(view({ leaderId: 4, leaderAge: 0.1 }))).toEqual([]);
    expect(kinds(view({ leaderId: null }))).toEqual([]);
  });

  it('draws a keeper reply as a grant or a refusal, from the keeper', () => {
    const granted = linksFor(view({ trackside: { platformKeeper: { age: 0.4, granted: true }, askedPlatformKeeper: 0.6 } }), 'ours');
    expect(granted).toEqual([expect.objectContaining({ kind: 'grant', from: { device: 'platformKeeper' } })]);
    const refused = linksFor(view({ trackside: { junctionKeeper: { age: 1, granted: false }, askedJunctionKeeper: 1.2 } }), 'ours');
    expect(refused).toEqual([expect.objectContaining({ kind: 'refuse', from: { device: 'junctionKeeper' } })]);
  });

  it('draws an unanswered request from the train to the keeper', () => {
    const asking = linksFor(view({ trackside: { askedJunctionKeeper: 0.5, junctionKeeper: { age: 30, granted: false } } }), 'ours');
    expect(asking).toEqual([expect.objectContaining({ kind: 'asking', from: { train: 4 }, to: { device: 'junctionKeeper' } })]);
  });

  it('lets an old request or reply drop off', () => {
    expect(kinds(view({ trackside: { askedPlatformKeeper: 10, platformKeeper: { age: 10, granted: true } } }))).toEqual([]);
  });

  it('draws the sensors for a train choosing a platform while the platform keeper is quiet', () => {
    const near = { pos: { track: 'A' as const, offset: 5800 }, x: 5800 };
    expect(kinds(view({ ...near, trackside: { sensorsAge: 0.3, askedPlatformKeeper: 0.4 } }))).toEqual(['asking', 'sensors']);
    // Not while the platform keeper answers, and not out of the sensors' range.
    expect(kinds(view({ ...near, trackside: { sensorsAge: 0.3, platformKeeper: { age: 0.2, granted: true } } }))).toEqual(['grant']);
    expect(kinds(view({ trackside: { sensorsAge: 0.3 } }))).toEqual([]);
    // Not for a train already standing in its platform.
    expect(kinds(view({ pos: { track: 'P1', offset: 250 }, x: 6250, trackside: { sensorsAge: 0.3 } }))).toEqual([]);
  });

  it('has a style for every kind', () => {
    for (const kind of LINK_KINDS) expect(LINK_STYLE[kind].css).toMatch(/^#[0-9a-f]{6}$/);
  });
});
