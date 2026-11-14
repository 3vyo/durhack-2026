import type { TrainOutput } from '../shared/types';

// The one place mode colours come from. The five colours were checked together with the
// data-viz palette checker on the scene background (#0f141b), every pair against every pair:
//
//   node validate_palette.js "#3987e5,#8a57ae,#008300,#c98500,#d55181" --mode dark --surface "#0f141b" --pairs all
//
// Every check passes, with one warning: the closest pair for colour-blind viewers
// (yellow and green) is 6.9 apart. That is allowed only with a second cue, so each mode also
// has its own shape. Do not change a colour without running the checker again.

export type Mode = TrainOutput['mode'];
export type MarkerShape = 'square' | 'hexagon' | 'circle' | 'triangle' | 'diamond';

export interface ModeStyle {
  hex: number;
  css: string;
  label: string;
  shape: MarkerShape;
  /** One line for the legend, from the mode table in docs/design.md. */
  meaning: string;
}

/** The order modes are listed in: who is in charge first, then how well a train knows the train ahead. */
export const MODES: readonly Mode[] = ['central', 'radio', 'full', 'stale', 'blind'];

export const MODE_STYLE: Record<Mode, ModeStyle> = {
  central: { hex: 0x3987e5, css: '#3987e5', label: 'Central', shape: 'square', meaning: 'Obeys the control centre' },
  radio: {
    hex: 0x8a57ae,
    css: '#8a57ae',
    label: 'Radio',
    shape: 'hexagon',
    meaning: 'Moved by staff over the radio, at caution speed',
  },
  full: { hex: 0x008300, css: '#008300', label: 'Full', shape: 'circle', meaning: 'Hears the train ahead' },
  stale: { hex: 0xc98500, css: '#c98500', label: 'Stale', shape: 'triangle', meaning: 'The last report from the train ahead is old' },
  blind: { hex: 0xd55181, css: '#d55181', label: 'Blind', shape: 'diamond', meaning: 'No report from the train ahead' },
};

/** The surfaces the colours were checked against. */
export const SURFACE = { scene: 0x0f141b, page: 0x0b0f14 } as const;

/** Text colours for the page. Text never wears a mode colour. */
export const TEXT = { primary: '#e6edf3', secondary: '#9fb0c3', muted: '#7d8da1' } as const;

function luminance(hex: number): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((hex >> 16) & 0xff) + 0.7152 * channel((hex >> 8) & 0xff) + 0.0722 * channel(hex & 0xff);
}

/** The WCAG contrast ratio of two 0xRRGGBB colours, from 1 to 21. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
