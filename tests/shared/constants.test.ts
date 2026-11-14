import { describe, expect, it } from 'vitest';
import { MARGIN, SENSOR_RANGE, SIGHT_SPEED, safeSpeed } from '../../src/shared/constants';

describe('safeSpeed', () => {
  it('is 0 at zero distance', () => {
    expect(safeSpeed(0)).toBe(0);
  });

  it('is about 21.2132 m/s at 250 m', () => {
    expect(safeSpeed(250)).toBeCloseTo(21.2132, 3);
  });

  it('is 0 for a negative distance', () => {
    expect(safeSpeed(-5)).toBe(0);
  });

  it('lets SIGHT_SPEED stop within SENSOR_RANGE - MARGIN', () => {
    expect(SIGHT_SPEED).toBeLessThanOrEqual(safeSpeed(SENSOR_RANGE - MARGIN));
  });
});
