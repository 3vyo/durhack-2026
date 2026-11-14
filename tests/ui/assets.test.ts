import { describe, expect, it } from 'vitest';
import { RAIL_PIECE, TRAIN_UNIT, assetUrl } from '../../src/ui/assets';

describe('assetUrl', () => {
  it('builds the path under the site base', () => {
    expect(assetUrl('x', '/')).toBe('/models/kenney-train-kit/x.glb');
    expect(assetUrl('x', './')).toBe('./models/kenney-train-kit/x.glb');
    expect(assetUrl('x', '/demo')).toBe('/demo/models/kenney-train-kit/x.glb');
  });

  it('names the subway unit nose first, and the track piece', () => {
    expect(TRAIN_UNIT[0]).toBe('train-electric-subway-a');
    expect(RAIL_PIECE).toBe('railroad-straight');
  });
});
