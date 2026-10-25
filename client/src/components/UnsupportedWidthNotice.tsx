import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const QUERY = '(max-width: 1279px)';
const KEY = 'flico.narrowNoticeDismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Flico is a desktop MVP (1280px+). Below that, show a dismissible, non-blocking notice. */
export function UnsupportedWidthNotice() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  if (!narrow || dismissed) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] px-4 py-2 text-[13px] leading-5 text-[var(--fl-warning)]">
      <p>Flico is designed for desktop screens at least 1280px wide. Some screens may not fit at this size.</p>
      <button
        type="button"
        className="grid h-8 w-8 flex-none place-items-center rounded-[8px] hover:bg-fl-surface/60"
        aria-label="Dismiss screen size notice"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(KEY, '1');
          } catch {
            /* storage unavailable: dismiss for this page view only */
          }
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
