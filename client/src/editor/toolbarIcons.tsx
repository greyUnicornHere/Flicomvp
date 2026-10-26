import { AlertTriangle, Check, Clock, Diamond, GitFork, Repeat, Square, SquareStop } from 'lucide-react';

export const TOOLBAR_ICONS = {
  action: <Square size={18} aria-hidden="true" />,
  decision: <Diamond size={18} aria-hidden="true" />,
  approval: <Check size={18} aria-hidden="true" />,
  wait: <Clock size={18} aria-hidden="true" />,
  finish: <SquareStop size={18} aria-hidden="true" />,
  loop: <Repeat size={18} aria-hidden="true" />,
  parallel: <GitFork size={18} aria-hidden="true" className="rotate-90" />,
  exception: <AlertTriangle size={18} aria-hidden="true" />,
};
