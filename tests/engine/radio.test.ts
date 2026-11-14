import { describe, expect, it } from 'vitest';
import { route, type Recipient, type Sender } from '../../src/engine/radio';
import { ALL_ON, type Switches } from '../../src/engine/switches';
import type { Message, Outgoing } from '../../src/shared/types';

const never = () => {
  throw new Error('rng should not be drawn');
};

function out(msg: Message, range: Outgoing['range']): Outgoing {
  return { msg, range };
}

const position = (from: number): Message => ({
  type: 'position',
  from,
  pos: { track: 'A', offset: 0 },
  speed: 10,
  sentAt: 0,
});

const trains = [
  { id: 1, x: 100 },
  { id: 2, x: 200 },
  { id: 3, x: 300 },
];

const fromTrain1: Sender = { kind: 'train', id: 1 };
const ids = (r: Recipient[]) => r.map((x) => (x.kind === 'train' ? x.id : x.id));

describe('route long range', () => {
  it('gives a position message to every other train when nothing is dropped', () => {
    const r = route(out(position(1), 'long'), fromTrain1, trains, ALL_ON, never);
    expect(ids(r)).toEqual([2, 3]);
  });

  it('drops every position message when the radio is at 100%', () => {
    const sw: Switches = { ...ALL_ON, radioDrop: 1 };
    expect(route(out(position(1), 'long'), fromTrain1, trains, sw, never)).toEqual([]);
  });

  it('drops each recipient on its own draw at a partial rate', () => {
    const draws = [0.25, 0.75];
    let i = 0;
    const sw: Switches = { ...ALL_ON, radioDrop: 0.5 };
    const r = route(out(position(1), 'long'), fromTrain1, trains, sw, () => draws[i++]);
    expect(ids(r)).toEqual([3]);
  });

  it('delivers a permit to its train even when the radio is at 100%', () => {
    const permit: Message = { type: 'permit', to: 2, untilX: 1000, nextTrack: null, sentAt: 0 };
    const sw: Switches = { ...ALL_ON, radioDrop: 1 };
    expect(ids(route(out(permit, 'long'), { kind: 'centre' }, trains, sw, never))).toEqual([2]);
  });

  it('delivers no permit while the centre is off', () => {
    const permit: Message = { type: 'permit', to: 2, untilX: 1000, nextTrack: null, sentAt: 0 };
    const sw: Switches = { ...ALL_ON, centre: false };
    expect(route(out(permit, 'long'), { kind: 'centre' }, trains, sw, never)).toEqual([]);
  });
});

describe('route short range', () => {
  const request = (from: number, resource: 'P1' | 'JUNCTION'): Message => ({
    type: 'lockRequest',
    from,
    resource,
  });

  it('reaches the platform keeper only from x 4300 to 6400', () => {
    const at = (x: number) =>
      route(out(request(1, 'P1'), 'short'), fromTrain1, [{ id: 1, x }], ALL_ON, never);
    expect(at(4299)).toEqual([]);
    expect(at(4300)).toEqual([{ kind: 'actor', id: 'platformKeeper' }]);
    expect(at(6400)).toEqual([{ kind: 'actor', id: 'platformKeeper' }]);
    expect(at(6401)).toEqual([]);
  });

  it('does not reach the platform keeper when it is switched off', () => {
    const sw: Switches = { ...ALL_ON, platformKeeper: false };
    expect(route(out(request(1, 'P1'), 'short'), fromTrain1, [{ id: 1, x: 5000 }], sw, never)).toEqual([]);
  });

  it('sends a junction request to the junction keeper from x 6000 to 6600', () => {
    const at = (x: number) =>
      route(out(request(1, 'JUNCTION'), 'short'), fromTrain1, [{ id: 1, x }], ALL_ON, never);
    expect(at(5999)).toEqual([]);
    expect(at(6000)).toEqual([{ kind: 'actor', id: 'junctionKeeper' }]);
    expect(at(6600)).toEqual([{ kind: 'actor', id: 'junctionKeeper' }]);
    expect(at(6601)).toEqual([]);
  });

  it('delivers an actor reply only to a train inside that actor range', () => {
    const grant: Message = { type: 'lockGrant', to: 1, resource: 'P1', follow: null };
    const from: Sender = { kind: 'actor', id: 'platformKeeper' };
    expect(route(out(grant, 'short'), from, [{ id: 1, x: 6500 }], ALL_ON, never)).toEqual([]);
    expect(ids(route(out(grant, 'short'), from, [{ id: 1, x: 6400 }], ALL_ON, never))).toEqual([1]);
  });

  it('delivers platform status only to trains from x 5500 to 6400', () => {
    const status: Message = { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 0 };
    const all = [
      { id: 1, x: 5499 },
      { id: 2, x: 5500 },
      { id: 3, x: 6400 },
      { id: 4, x: 6401 },
    ];
    expect(ids(route(out(status, 'short'), { kind: 'sensors' }, all, ALL_ON, never))).toEqual([2, 3]);
  });

  it('delivers no platform status when the sensors are off', () => {
    const status: Message = { type: 'platformStatus', platform: 'P1', occupied: false, sentAt: 0 };
    const sw: Switches = { ...ALL_ON, sensors: false };
    expect(route(out(status, 'short'), { kind: 'sensors' }, [{ id: 1, x: 6000 }], sw, never)).toEqual([]);
  });
});

describe('route radio working permits', () => {
  const permit: Message = { type: 'permit', to: 2, untilX: 1000, nextTrack: null, sentAt: 0, caution: true };
  const radio: Sender = { kind: 'radio' };

  it('delivers a radio working permit to its train while the centre is off', () => {
    const sw: Switches = { ...ALL_ON, centre: false };
    expect(ids(route(out(permit, 'long'), radio, trains, sw, never))).toEqual([2]);
  });

  it('drops a radio working permit when the radio is down, because it travels by radio', () => {
    const sw: Switches = { ...ALL_ON, centre: false, radioDrop: 1 };
    expect(route(out(permit, 'long'), radio, trains, sw, never)).toEqual([]);
  });
});
