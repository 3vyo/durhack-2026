import { describe, expect, it } from 'vitest';
import type { Message, TrainState } from '../../src/shared/types';
import {
  isPermitFresh,
  latestPermit,
  permitLimit,
  suggestedPlatform,
  type HeldPermit,
} from '../../src/train/permits';

const permit: HeldPermit = { untilX: 6000, nextTrack: 'P1', sentAt: 9 };
const self: TrainState = { id: 1, pos: { track: 'A', offset: 1000 }, speed: 30, brokenDown: false };
const forMe: Message = { type: 'permit', to: 1, untilX: 6000, nextTrack: 'P1', sentAt: 9 };

describe('permits.ts placeholders', () => {
  it('latestPermit ignores every permit', () => {
    expect(latestPermit(null, [forMe], 1)).toBeNull();
    expect(latestPermit(permit, [forMe], 1)).toBeNull();
  });

  it('isPermitFresh is always false', () => {
    expect(isPermitFresh(permit, 10)).toBe(false);
    expect(isPermitFresh(null, 10)).toBe(false);
  });

  it('permitLimit is 0 with or without a permit', () => {
    expect(permitLimit(self, permit, 10)).toBe(0);
    expect(permitLimit(self, null, 10)).toBe(0);
  });

  it('suggestedPlatform suggests nothing', () => {
    expect(suggestedPlatform(permit, 10, 'A')).toBeNull();
  });
});

describe('Following permits: reading permits', () => {
  it.todo('keeps the newest permit addressed to this train');
  it.todo('ignores permits addressed to other trains');
  it.todo('ignores a permit with an older sentAt than the one it holds');
  it.todo('keeps its last permit when the inbox has none');
});

describe('Following permits: freshness', () => {
  it.todo('a permit is fresh while it is under 5 seconds old');
  it.todo('a permit 5 seconds old or older is not fresh');
  it.todo('no permit is not fresh');
  it.todo('when permits return after an outage, the train follows them on the next tick');
});

describe('Following permits: untilX', () => {
  it.todo('a fresh permit limits speed so the train stops at or before untilX');
  it.todo('the untilX limit is safeSpeed of the distance from the train x to untilX');
  it.todo('the untilX limit is 0 at or past untilX');
  it.todo('brakes one tick early for untilX, like a stop point');
  it.todo('a permit that is not fresh adds no limit');
  it.todo('no permit adds no limit');
  it.todo('the untilX limit only lowers speed and never raises it above the other limits');
  it.todo('an old but still fresh permit can hold the train back for up to 5 seconds');
});

describe('Following permits: platform suggestion', () => {
  it.todo('a fresh permit suggests its nextTrack as the platform to ask for');
  it.todo('ignores a suggested platform from the other pair');
  it.todo('ignores a nextTrack that is not a platform (A, B, EXIT or null)');
  it.todo('a permit that is not fresh suggests nothing');
  it.todo('the station grant or alternative wins over the suggestion');
});

describe('Following permits: permits never replace the train rules', () => {
  it.todo('with a fresh permit the train still keeps its leader limit, sightAhead limit and stop points');
  it.todo('with a fresh permit the train still needs a platform lock before it passes the end of its entry track');
  it.todo('with a fresh permit the train still needs a junction lock or an open slot to leave the platform');
  it.todo('after permits stop, the train drops the untilX limit and the suggestion and carries on');
  it.todo('when permits return, the train keeps the locks it holds');
  it.todo('when permits return, the train keeps a platform it has already chosen');
});
