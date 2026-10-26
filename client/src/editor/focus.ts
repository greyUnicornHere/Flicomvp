/**
 * Focus an element as soon as it can take focus. New diagram steps stay hidden until they have been
 * measured, and the browser refuses to focus hidden elements, so retry for a few frames.
 */
export function focusWhenReady(get: () => HTMLElement | null | undefined, options: { select?: boolean } = {}, frames = 30) {
  const attempt = (left: number) => {
    const el = get();
    if (el) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) {
        if (options.select && el instanceof HTMLInputElement) el.select();
        return;
      }
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(frames);
}
