export type TrainId = number;
export type TrackId = 'A' | 'B' | 'P1' | 'P2' | 'P3' | 'P4' | 'EXIT';
export type PlatformId = 'P1' | 'P2' | 'P3' | 'P4';
export type ResourceId = PlatformId | 'JUNCTION';

export interface Position { track: TrackId; offset: number }

export interface TrainState {
  id: TrainId;
  pos: Position;          // front of the train
  speed: number;
  brokenDown: boolean;
}

export interface TimetableEntry {
  id: TrainId;
  entry: 'A' | 'B';
  enterAt: number;
  platform: PlatformId;   // default platform, always in the entry track's own pair
  leader: TrainId | null; // the train directly ahead on the same entry track
  dwell: number;          // seconds to wait in the platform
}

export type Message =
  | { type: 'position'; from: TrainId; pos: Position; speed: number; sentAt: number }
  | { type: 'lockRequest'; from: TrainId; resource: ResourceId }
  | { type: 'lockGrant'; to: TrainId; resource: ResourceId; follow: TrainId | null }
  | { type: 'lockRefuse'; to: TrainId; resource: ResourceId; alternative: PlatformId | null }
  | { type: 'platformStatus'; platform: PlatformId; occupied: boolean; sentAt: number }
  // From the control centre, or from staff by radio while it is down. `leader` is the train
  // directly ahead on this train's path, null if there is none, and absent if the sender does
  // not say. `caution` is true for a radio working permit: the train stays at SIGHT_SPEED or below.
  | {
      type: 'permit';
      to: TrainId;
      untilX: number;
      nextTrack: TrackId | null;
      sentAt: number;
      leader?: TrainId | null;
      caution?: boolean;
    };

export interface Outgoing { msg: Message; range: 'long' | 'short' }

export interface TrainInput {
  now: number;
  self: TrainState;
  inbox: Message[];
  sightAhead: number | null; // metres to the nearest train on this train's path, or null if none within SENSOR_RANGE
}

export interface TrainOutput {
  accel: number;             // between -BRAKE and ACCEL
  nextTrack: TrackId | null; // where to go at the end of the current track
  outbox: Outgoing[];
  mode: 'central' | 'full' | 'stale' | 'blind'; // for the display only
}

export interface TrainAgent {
  decide(input: TrainInput): TrainOutput;
}

// Every agent is built from its own ID and the full timetable, and nothing else.
export type TrainAgentFactory = (id: TrainId, timetable: TimetableEntry[]) => TrainAgent;

export interface SensorReadings {
  platformOccupied: Record<PlatformId, boolean>;
  junctionOccupied: boolean;
  exitStartClear: boolean;   // true if the first 300 m of EXIT is empty
}

export interface LocalActor {
  id: 'station' | 'merge';
  step(now: number, inbox: Message[], sensors: SensorReadings): Outgoing[];
}
