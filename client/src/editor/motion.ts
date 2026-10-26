/** Animation length that respects the person's reduced-motion setting. */
export function motionDuration(ms: number): number {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}
