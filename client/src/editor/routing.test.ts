import { describe, expect, it } from 'vitest';
import { curveCrosses, detour, roundedPath, type Box } from './routing';

const box = (left: number, top: number, w = 184, h = 72): Box => ({ left, top, right: left + w, bottom: top + h });

describe('arrow routing', () => {
  const source = { x: 184, y: 36 }; // right side of a step at (0,0)
  const target = { x: 864, y: 36 }; // left side of a step three columns away

  it('keeps the normal curve when nothing is in the way', () => {
    expect(curveCrosses(source, target, [box(288, 200), box(576, -200)])).toBe(false);
  });

  it('notices a step sitting on the curve', () => {
    expect(curveCrosses(source, target, [box(450, 0)])).toBe(true);
  });

  it('detours through the nearest clear lane and around every step in the way', () => {
    const inTheWay = [box(450, 0), box(450, 128)];
    const route = detour(source, target, inTheWay)!;
    expect(route).not.toBeNull();
    for (const b of inTheWay) {
      const laneInsideStep = route.lane > b.top - 18 && route.lane < b.bottom + 18;
      expect(laneInsideStep).toBe(false);
    }
    expect(route.lane).toBeLessThan(0); // above is nearer than below the two stacked steps
    expect(route.out).toBeGreaterThan(source.x);
    expect(route.back).toBeLessThan(target.x);
  });

  it('does not detour backwards arrows', () => {
    expect(detour({ x: 900, y: 0 }, { x: 100, y: 0 }, [box(400, -30)])).toBeNull();
  });

  it('draws rounded corners', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 200, y: 100 }]);
    expect(d.startsWith('M 0,0')).toBe(true);
    expect(d).toContain('Q 40,0');
    expect(d.endsWith('L 200,100')).toBe(true);
  });
});
