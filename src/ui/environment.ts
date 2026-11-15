// The look of the world around the railway, and the quality setting. Pure, so the tests never
// load three.js. scene.ts reads these values.

export type Quality = 'high' | 'low';

/** `?quality=low` in the page address turns off the costly parts for a weak laptop. */
export function parseQuality(search: string): Quality {
  const value = new URLSearchParams(search).get('quality');
  return value !== null && value.toLowerCase() === 'low' ? 'low' : 'high';
}

export interface QualityPreset {
  shadows: boolean;
  antialias: boolean;
  /** The most screen pixels per CSS pixel the renderer uses. */
  pixelRatioCap: number;
  shadowMapSize: number;
  /** Trees around the railway. Decoration only. */
  trees: number;
}

export function qualityPreset(q: Quality): QualityPreset {
  if (q === 'low') return { shadows: false, antialias: false, pixelRatioCap: 1, shadowMapSize: 0, trees: 0 };
  return { shadows: true, antialias: true, pixelRatioCap: 2, shadowMapSize: 2048, trees: 24 };
}

/**
 * Colours and lights, in native scene units. Fog starts and ends at these multiples of the
 * camera's distance from what it looks at, so it hazes the far edges in both camera views
 * without hiding the railway.
 */
export const ENVIRONMENT = {
  sky: ['#1d3150', '#2f4b6c', '#4a647e'] as const,
  ground: 0x2d4a39,
  fog: { color: 0x3d556f, near: 1.4, far: 3.2 },
  hemisphere: { sky: 0xcfe3ff, ground: 0x2b3b30, intensity: 1.15 },
  sun: { color: 0xffe6c0, intensity: 2.4 },
  exposure: 1.05,
} as const;
