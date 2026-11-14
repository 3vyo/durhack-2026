import type { PlatformId } from './types';

/** The two platforms each entry track owns. From "Station switched off" in docs/design.md. */
export const PLATFORM_PAIRS: Record<'A' | 'B', readonly [PlatformId, PlatformId]> = {
  A: ['P1', 'P2'],
  B: ['P3', 'P4'],
};
