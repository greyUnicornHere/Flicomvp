import { useCallback, useEffect, useState } from 'react';

/**
 * Browser full screen for the whole Flico page (like F11), so floating panels, menus and dialogs
 * keep working. Esc or the browser's own controls exit it as usual.
 */
export function useFullscreen() {
  const [active, setActive] = useState(() => typeof document !== 'undefined' && document.fullscreenElement !== null && document.fullscreenElement !== undefined);
  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const enter = useCallback(async () => {
    if (!document.fullscreenEnabled || document.fullscreenElement) return;
    await document.documentElement.requestFullscreen().catch(() => {});
  }, []);
  const exit = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }, []);
  return { active, supported, enter, exit };
}
