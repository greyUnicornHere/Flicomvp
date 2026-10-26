import { AlertTriangle, Check, Circle, Clock, Diamond, Square, SquareStop, type LucideIcon } from 'lucide-react';
import type { StepType } from '../../../shared/graph';

/** Icon and name for each step type. Meaning is always shown by icon + text, never colour alone. */
export const STEP_META: Record<StepType, { icon: LucideIcon; name: string }> = {
  start: { icon: Circle, name: 'Start' },
  action: { icon: Square, name: 'Action' },
  decision: { icon: Diamond, name: 'Decision' },
  approval: { icon: Check, name: 'Approval' },
  wait: { icon: Clock, name: 'Wait' },
  finish: { icon: SquareStop, name: 'Finish' },
  exception: { icon: AlertTriangle, name: 'Exception' },
};

export const DURATION_UNITS = ['minutes', 'hours', 'days', 'weeks'] as const;
