import type {
  LocalActor,
  Message,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainAgentFactory,
  TrainId,
  TrainState,
} from '../shared/types';

/**
 * Message timing: a message sent on tick t is in the recipient's inbox on tick t + 1.
 * This holds for trains, local actors and the control centre alike, so request timers
 * and tests can rely on it.
 */

/**
 * The control centre sees the true state of every train. While it is switched on, the
 * engine calls step once per simulated second and delivers the returned messages
 * (permits) over long range.
 *
 * `sensors` is the true occupancy of the track, from the centre's own train detection. It
 * does not depend on our platform sensors, which only our trains use. `routes` is the track
 * each train has set to take next, as the signalling shows it. The centre is today's
 * system, so it never depends on the platform keeper, the junction keeper or our platform sensors.
 */
export interface ControlCentre {
  step(now: number, trains: TrainState[], sensors: SensorReadings, routes: Map<TrainId, TrackId | null>): Message[];
  /**
   * Radio working: staff moving trains by radio while the centre is down. The engine calls it
   * once per simulated second while the centre is switched off. Its permits go over long
   * range, and the radio slider drops them like any train-to-train message.
   */
  radioStep?(now: number, trains: TrainState[], sensors: SensorReadings, routes: Map<TrainId, TrackId | null>): Message[];
}

/**
 * Everything one system under test supplies: its train agents, its local actors and
 * its control centre. The engine runs the baseline and ours through the same shape.
 */
export interface TrainProgram {
  name: 'baseline' | 'ours';
  agentFactory: TrainAgentFactory;
  makeActors(timetable: TimetableEntry[]): LocalActor[];
  makeCentre(timetable: TimetableEntry[]): ControlCentre | null;
}
