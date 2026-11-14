// The baseline: today's railway, where a control centre decides everything and a train
// with no permit stops. See "Today's rule, for comparison" in docs/design.md.

export { makeCentre } from './centre';
export type { CentreOptions } from './centre';
export { createBaselineAgent } from './train';
