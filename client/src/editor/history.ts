import { useCallback, useReducer } from 'react';
import type { WorkflowGraph } from '../../../shared/graph';

const LIMIT = 100;

export type HistoryState = { past: WorkflowGraph[]; present: WorkflowGraph; future: WorkflowGraph[] };

export type HistoryAction =
  | { type: 'commit'; graph: WorkflowGraph; /** fold into the previous step (e.g. naming a just-added step) */ merge?: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; graph: WorkflowGraph };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'commit': {
      if (action.graph === state.present) return state;
      if (action.merge && state.past.length > 0) return { past: state.past, present: action.graph, future: [] };
      return { past: [...state.past, state.present].slice(-LIMIT), present: action.graph, future: [] };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future: rest };
    }
    case 'reset':
      return { past: [], present: action.graph, future: [] };
  }
}

/** Editor history: every user action is one undoable step (session only; not kept across reloads). */
export function useGraphHistory(initial: WorkflowGraph) {
  const [state, dispatch] = useReducer(historyReducer, { past: [], present: initial, future: [] });
  return {
    graph: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback((graph: WorkflowGraph, merge = false) => dispatch({ type: 'commit', graph, merge }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
  };
}
