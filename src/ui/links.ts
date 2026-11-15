import type { TrainView } from '../engine/engine';
import { FRESH, PERMIT_FRESH, REQUEST_REPEAT, TRAIN_LENGTH } from '../shared/constants';
import type { Switches } from '../engine/switches';
import { PLATFORMS, RANGE, inRange, isEntryTrack, pairOf } from '../shared/map';
import type { PlatformId, TrainId } from '../shared/types';
import type { DeviceKey } from './layout';

// The lines the scene draws from each train to whatever it is taking its next move from: the
// control centre, a keeper, the platform sensors or the train ahead. They come only from what
// the engine says the train heard and sent, and the train's mode, so they never claim more
// than a train knows. Each line fades as the message it stands for gets older.

/** Which program the train runs. A baseline train only ever listens to the centre. */
export type Program = 'baseline' | 'ours';

export type LinkKind = 'permit' | 'staff' | 'leader' | 'grant' | 'refuse' | 'asking' | 'sensors' | 'wired';

/** One end of a line: a piece of trackside equipment, one platform's sensor box, or a train. */
export type LinkEnd = { device: Exclude<DeviceKey, 'sensors'> } | { sensor: PlatformId } | { train: TrainId };

export interface Link {
  kind: LinkKind;
  /** Where the information comes from. For `asking` it is the train, since the train is talking. */
  from: LinkEnd;
  to: LinkEnd;
  /** 1 for a message that just arrived, down towards 0 as it gets older. */
  strength: number;
  /** A short line of text to show beside the train, if any. */
  note?: string;
}

export interface LinkStyle {
  css: string;
  /** True for a dashed line. Dashes move from the sender to the receiver. */
  dashed: boolean;
  /** True for a cable along the ground, false for a radio message arcing through the air. */
  ground?: boolean;
  label: string;
  meaning: string;
}

export const LINK_STYLE: Record<LinkKind, LinkStyle> = {
  permit: { css: '#3987e5', dashed: false, label: 'Permit', meaning: 'The control centre says how far to run' },
  staff: { css: '#8a57ae', dashed: false, label: 'Radio working', meaning: 'Staff move the train by radio' },
  leader: { css: '#2fbf4a', dashed: false, label: 'Train ahead', meaning: 'The train ahead says where it is' },
  grant: { css: '#2fb8a6', dashed: false, label: 'Grant', meaning: 'A keeper lets the train in' },
  refuse: { css: '#e0703a', dashed: false, label: 'Refused', meaning: 'A keeper says wait' },
  asking: { css: '#aab4c0', dashed: true, label: 'Asking', meaning: 'The train asks a keeper and hears nothing back' },
  sensors: { css: '#d9c46a', dashed: false, label: 'Sensors', meaning: 'The two platforms of its pair say empty or occupied, by radio' },
  wired: {
    css: '#c9d4e0',
    dashed: false,
    ground: true,
    label: 'Wired',
    meaning: "Each platform's sensor reports to the platform keeper by cable",
  },
};

/** The order the key lists the lines in. */
export const LINK_KINDS: readonly LinkKind[] = ['permit', 'staff', 'leader', 'grant', 'refuse', 'asking', 'sensors', 'wired'];

/**
 * The cables from each platform's sensor box to the platform keeper. The keeper reads them
 * every tick without radio. Only our program has a platform keeper, so the baseline has none.
 * A cable is faint while the sensors or the keeper are switched off.
 */
export function wiredLinks(sw: Pick<Switches, 'sensors' | 'platformKeeper'>, program: Program): Link[] {
  if (program === 'baseline') return [];
  const strength = sw.sensors && sw.platformKeeper ? 0.6 : 0;
  return PLATFORMS.map((p) => ({ kind: 'wired', from: { sensor: p }, to: { device: 'platformKeeper' }, strength }));
}

/** A permit older than this has missed at least one of the centre's once-a-second sends. */
const PERMIT_LATE = 1.5;
/** How long a keeper's reply or a request stays drawn. Requests repeat every REQUEST_REPEAT. */
const replyWindow = (): number => REQUEST_REPEAT + 0.5;
/** How long a sensor status stays drawn. The sensors send once a second. */
const STATUS_WINDOW = 1.5;
/** A leader report older than FRESH still counts, faintly: the train ahead cannot have gone backwards. */
const STALE_STRENGTH = 0.35;

function fade(age: number, window: number): number {
  return Math.max(0, Math.min(1, 1 - age / window));
}

/** Whole seconds, for a note a judge reads at a glance. */
function secs(age: number): string {
  return `${Math.floor(age)} s`;
}

/** How far inside each end of the frame a train's lines take to fade in fully, in metres. */
export const LINK_FADE = 200;

/**
 * How much of a train's lines to show, from 0 to 1, by where its middle is. A train outside
 * the stretch the scene shows (the frame) gets none, so a train far up the line has no line
 * reaching off into the distance. Lines fade in over LINK_FADE metres inside each end of the
 * frame, so they appear and go smoothly as a train moves in and out.
 */
export function linkReach(frontX: number, frame: { xMin: number; xMax: number }): number {
  const middle = frontX - TRAIN_LENGTH / 2;
  const fromStart = (middle - frame.xMin) / LINK_FADE;
  const fromEnd = (frame.xMax - middle) / LINK_FADE;
  return Math.max(0, Math.min(1, fromStart, fromEnd));
}

/**
 * The lines for one train. A train obeying the centre gets one line, its permit. When the
 * permits stop, that line fades over PERMIT_FRESH seconds with a countdown beside the train.
 * After that a baseline train has nothing to listen to, so it has no lines. One of ours shows
 * what its own rules run on: the train ahead, the keepers, and the sensors when it has to use
 * the fixed split.
 */
export function linksFor(v: TrainView, program: Program): Link[] {
  const self = { train: v.id };
  const centre = { device: 'centre' as const };

  if (v.mode === 'central' || v.mode === 'radio') {
    const age = v.permitAge ?? 0;
    const link: Link = {
      kind: v.mode === 'central' ? 'permit' : 'staff',
      from: centre,
      to: self,
      strength: Math.max(0.15, fade(age, PERMIT_FRESH)),
    };
    if (age >= PERMIT_LATE) {
      const then = program === 'ours' ? 'switches to its own rules' : 'stops';
      link.note = `No permit for ${secs(age)}. At ${PERMIT_FRESH} s it ${then}`;
    }
    return [link];
  }
  if (program === 'baseline') return [];

  const links: Link[] = [];
  const t = v.trackside;

  // The train ahead, while the train knows who it is and has heard from it.
  if (v.leaderId !== null && v.leaderId !== v.id && v.leaderAge !== null) {
    const strength = v.leaderAge < FRESH ? 1 - 0.5 * (v.leaderAge / FRESH) : STALE_STRENGTH;
    links.push({ kind: 'leader', from: { train: v.leaderId }, to: self, strength });
  }

  // Each keeper: its last reply while it is recent, else the train's own unanswered request.
  const keepers = [
    { device: 'platformKeeper' as const, reply: t.platformKeeper, asked: t.askedPlatformKeeper },
    { device: 'junctionKeeper' as const, reply: t.junctionKeeper, asked: t.askedJunctionKeeper },
  ];
  for (const k of keepers) {
    if (k.reply !== null && k.reply.age <= replyWindow()) {
      links.push({
        kind: k.reply.granted ? 'grant' : 'refuse',
        from: { device: k.device },
        to: self,
        strength: Math.max(0.3, fade(k.reply.age, replyWindow())),
      });
    } else if (k.asked !== null && k.asked <= replyWindow()) {
      links.push({ kind: 'asking', from: self, to: { device: k.device }, strength: Math.max(0.4, fade(k.asked, replyWindow())) });
    }
  }

  // The sensors matter to a train that is choosing a platform without the platform keeper: one
  // still on its entry line, with no recent answer from the keeper.
  const keeperQuiet = t.platformKeeper === null || t.platformKeeper.age > replyWindow();
  const sensorsAge = t.sensorsAge;
  const heardSensors = sensorsAge !== null && sensorsAge <= STATUS_WINDOW;
  if (heardSensors && isEntryTrack(v.pos.track) && keeperQuiet && inRange(v.x, RANGE.sensors)) {
    // The train only looks at the two platforms of its own pair.
    for (const p of pairOf(v.pos.track)) {
      links.push({ kind: 'sensors', from: { sensor: p }, to: self, strength: fade(sensorsAge, STATUS_WINDOW * 1.5) });
    }
  }
  return links;
}
