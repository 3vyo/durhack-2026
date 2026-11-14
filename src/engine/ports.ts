import type {
  LocalActor,
  Message,
  SensorReadings,
  TimetableEntry,
  TrainAgentFactory,
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
 * `alive` says whether the station and merge actors are switched on. A baseline centre
 * treats the track of a dead actor as unavailable, so it needs this.
 */
export interface ControlCentre {
  step(
    now: number,
    trains: TrainState[],
    sensors: SensorReadings,
    alive: { station: boolean; merge: boolean },
  ): Message[];
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
