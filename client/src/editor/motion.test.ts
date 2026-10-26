import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionDuration } from './motion';

describe('motionDuration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('animates normally', () => {
    expect(motionDuration(200)).toBe(200);
  });

  it('skips animation when the person prefers reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(motionDuration(200)).toBe(0);
  });
});
