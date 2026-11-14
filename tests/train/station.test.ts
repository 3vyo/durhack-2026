import { describe, expect, it } from 'vitest';
import type { Message, TrainState } from '../../src/shared/types';
import {
  creepStep,
  dwellStart,
  fallbackLimit,
  fixedSplitPlatform,
  hasFreshStatus,
  pathJustChanged,
  platformRequest,
  platformToAsk,
  recordPlatformStatus,
  refusalMeansSilence,
  shouldUseFallback,
  stationReply,
  type PlatformStatusLog,
} from '../../src/train/station';

const stopped: TrainState = { id: 1, pos: { track: 'A', offset: 5999 }, speed: 0, brokenDown: false };
const inPlatform: TrainState = { id: 1, pos: { track: 'P1', offset: 299.9 }, speed: 0, brokenDown: false };
const grant: Message = { type: 'lockGrant', to: 1, resource: 'P1', follow: null };
const refuse: Message = { type: 'lockRefuse', to: 1, resource: 'P1', alternative: null };
const status: Message = { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 9 };
const log: PlatformStatusLog = { P1: { occupied: false, sentAt: 9 } };

describe('station.ts placeholders', () => {
  it('stationReply hears nothing', () => {
    expect(stationReply([grant, refuse], 1)).toBeNull();
  });

  it('platformToAsk asks for the default platform', () => {
    expect(platformToAsk('P2', 'P1', 'P1')).toBe('P2');
  });

  it('platformRequest asks for nothing', () => {
    expect(
      platformRequest({ now: 100, id: 1, pos: { track: 'A', offset: 4800 }, asking: 'P1', lastSentAt: null }),
    ).toBeNull();
  });

  it('dwellStart never starts the dwell timer', () => {
    expect(dwellStart(null, inPlatform, 100)).toBeNull();
  });

  it('shouldUseFallback is false', () => {
    expect(
      shouldUseFallback({ self: stopped, now: 100, lastReplyAt: null, refusalIsSilence: true, usingFallback: true }),
    ).toBe(false);
  });

  it('fixedSplitPlatform waits', () => {
    expect(fixedSplitPlatform('A', log, 10)).toBeNull();
  });

  it('creepStep looks at nothing and takes nothing', () => {
    expect(creepStep({ entry: 'A', probing: 'P1', sightAhead: null })).toEqual({ probe: null, take: null });
  });

  it('fallbackLimit is 0 whether or not the fallback is in use', () => {
    expect(fallbackLimit(true)).toBe(0);
    expect(fallbackLimit(false)).toBe(0);
  });

  it('pathJustChanged is always true, so the train never accelerates', () => {
    expect(pathJustChanged('P1', 'P1')).toBe(true);
    expect(pathJustChanged(null, null)).toBe(true);
  });

  it('recordPlatformStatus learns nothing new', () => {
    const prev: PlatformStatusLog = {};
    expect(recordPlatformStatus(prev, [status])).toBe(prev);
  });

  it('hasFreshStatus is false', () => {
    expect(hasFreshStatus(log, 'P1', 10)).toBe(false);
  });

  it('refusalMeansSilence is false, so the train keeps waiting', () => {
    expect(
      refusalMeansSilence({
        reply: { kind: 'refuse', platform: 'P1', alternative: null },
        statuses: {},
        entry: 'A',
        pos: { track: 'A', offset: 5900 },
        now: 100,
      }),
    ).toBe(false);
  });
});

describe('Entering the station: no platform, no entry', () => {
  it.todo('a train with no platform stops at or before the end of A or B');
  it.todo('a train with no platform never sets nextTrack to a platform');
});

describe('Entering the station: asking', () => {
  it.todo('sends no platform request before the ask point at offset 4800');
  it.todo('sends a lockRequest for a platform over short range at the ask point');
  it.todo('repeats the request every 2 seconds');
  it.todo('does not repeat the request sooner than 2 seconds');
  it.todo('asks for the platform a fresh permit suggests');
  it.todo('asks for its default platform when it has no fresh permit');
  it.todo('asks for its default platform when the permit suggests a platform from the other pair');
  it.todo('if the team picks the repeat-until-in-platform guard, keeps requesting its platform until its front is in it');
});

describe('Entering the station: replies', () => {
  it.todo('reads a lockGrant for a platform addressed to itself');
  it.todo('reads a lockRefuse for a platform addressed to itself');
  it.todo('ignores grants and refusals addressed to other trains');
  it.todo('ignores a JUNCTION grant or refusal when reading station replies');
  it.todo('when one inbox holds a grant and a refusal for this train, the grant wins');
  it.todo('on a lockGrant, sets nextTrack to the granted platform and runs in');
  it.todo('on a lockRefuse with an alternative, requests the alternative');
  it.todo('the refusal alternative wins over the permit suggestion');
  it.todo('on a lockRefuse with no alternative, keeps braking and keeps asking');
  it.todo('with no reply at all, stops before the end of its entry track (silence means no)');
  it.todo('may change nextTrack on any tick until its front crosses the end of the track, and not after');
});

describe('Entering the station: dwell', () => {
  it.todo('starts the dwell timer at the moment it stops in its platform');
  it.todo('does not start the dwell timer while still moving in the platform');
  it.todo('does not start the dwell timer when stopped on an entry track');
  it.todo('does not restart the dwell timer once started');
});

describe('Station switched off: when to use the fallback', () => {
  it.todo('uses the fallback when stopped at the end of its entry track with no reply');
  it.todo('does not use the fallback while still moving');
  it.todo('does not use the fallback after any station reply, unless a refusal counts as silence');
  it.todo('uses the fallback after a refusal that counts as silence');
  it.todo('counts as no reply when the station has not replied for a while, even after an earlier reply');
  it.todo('keeps using the fallback while it moves into the platform it picked');
});

describe('Station switched off: fixed split', () => {
  it.todo('track A owns P1 and P2');
  it.todo('track B owns P3 and P4');
  it.todo('takes the lowest-numbered platform of its pair whose sensor says empty');
  it.todo('takes the second platform when the first says occupied and the second says empty');
  it.todo('waits when both platforms of its pair say occupied');
  it.todo('never takes a platform from the other pair');
  it.todo('does not treat a platform with no fresh status as empty');
  it.todo('enters a fallback platform at SIGHT_SPEED or below');
});

describe('Station switched off: creeping with the sensors off too', () => {
  it.todo('creeps when it has no fresh status from either platform of its pair');
  it.todo('first sets nextTrack to the first platform of its pair to look into it');
  it.todo('takes the probed platform when sightAhead on the next tick shows no train in it');
  it.todo('switches nextTrack to the other platform when sightAhead shows a train in the first');
  it.todo('waits when both platforms show a train');
  it.todo('does not judge a platform from sightAhead on the tick it changed nextTrack');
  it.todo('does not accelerate on the tick it changes nextTrack, because sightAhead still reports the old path');
  it.todo('may accelerate again on the tick after it changed nextTrack');
  it.todo('creeps at SIGHT_SPEED or below');
});

describe('Platform sensors switched off', () => {
  it.todo('records the newest platformStatus for each platform');
  it.todo('ignores a platformStatus older than the one it holds');
  it.todo('a platformStatus under FRESH seconds old is fresh');
  it.todo('a platformStatus FRESH seconds old or older is not fresh');
  it.todo('between x 5500 and 6400, a platform with no fresh status counts as having no sensor');
  it.todo('before x 5500, hearing no status is normal and does not count as a dead sensor');
  it.todo('a refusal with no alternative and no fresh platformStatus from its pair counts as silence');
  it.todo('a refusal with no alternative and a fresh platformStatus from its pair does not count as silence');
  it.todo('a refusal with an alternative never counts as silence');
  it.todo('a fresh platformStatus from the other pair does not stop a refusal counting as silence');
  it.todo('after a refusal that counts as silence, uses the station-off rule and creeps');
});
