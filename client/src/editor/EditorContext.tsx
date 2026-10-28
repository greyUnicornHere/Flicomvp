import { createContext, useContext } from 'react';
import type { WorkflowGraph } from '../../../shared/graph';
import type { Issue } from '../../../shared/validation';
import type { Slot } from './ops';

/** Shared editor state and commands for the canvas's custom nodes and edges. */
export type EditorUi = {
  graph: WorkflowGraph;
  editingId: string | null;
  hoveredEdgeId: string | null;
  selectedEdgeId: string | null;
  issuesByNode: Map<string, Issue[]>;
  /** An AI proposal is shown on the canvas: editing is paused until it is applied or cancelled. */
  previewing: boolean;
  openInsertMenu: (slot: Slot, anchor: HTMLElement) => void;
  commitName: (nodeId: string, label: string) => void;
  cancelName: () => void;
  hoverEdge: (edgeId: string | null) => void;
};

export const EditorUiContext = createContext<EditorUi | null>(null);

export function useEditorUi(): EditorUi {
  const ui = useContext(EditorUiContext);
  if (!ui) throw new Error('useEditorUi must be used inside the editor');
  return ui;
}
