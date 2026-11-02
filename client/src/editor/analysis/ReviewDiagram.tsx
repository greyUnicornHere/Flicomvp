import { useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type NodeChange } from '@xyflow/react';
import type { WorkflowGraph } from '../../../../shared/graph';
import { CanvasControls } from '../CanvasControls';
import { EditorUiContext, type EditorUi } from '../EditorContext';
import { FlowEdge, type FlowEdgeType } from '../FlowEdge';
import { flowEdges, flowNodes, type Display, type Focus } from '../flowElements';
import { reviewLayout } from './reviewLayout';
import { motionDuration } from '../motion';
import { StepNode, type StepFlowNode } from '../StepNode';

const nodeTypes = { step: StepNode };
const edgeTypes = { flow: FlowEdge };
const noop = () => {};

type Props = {
  display: Display;
  focus: (id: string) => Focus | undefined;
  onSelectElement: (id: string) => void;
  /** Steps to bring into view (e.g. the selected recommendation's). */
  revealIds: string[];
  label: string;
  /** Automation labels to draw on the blocks (only while the Automation view is open). */
  assessments?: EditorUi['assessments'];
  onOpenAssessment?: (stepId: string) => void;
};

/** The single review diagram: read-only, with proposed changes drawn on the analysed workflow. */
export function ReviewDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <Diagram {...props} />
    </ReactFlowProvider>
  );
}

function Diagram({ display: shown, focus, onSelectElement, revealIds, label, assessments, onOpenAssessment }: Props) {
  const rf = useReactFlow<StepFlowNode, FlowEdgeType>();
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  // The review always shows a tidy, change-aware arrangement: the proposed workflow neatly laid out,
  // removed steps in a lane below (view only: the saved layout is untouched).
  const display = useMemo(() => ({ ...shown, graph: reviewLayout(shown) }), [shown]);
  const nodes = useMemo(() => flowNodes(display, { dims, focus }), [display, dims, focus]);
  const edges = useMemo(() => flowEdges(display, { dims, focus }), [display, dims, focus]);

  // Whenever the arrangement changes (e.g. a recommendation is rejected), show the whole workflow again.
  const layoutKey = display.graph.nodes.map((n) => `${n.id}:${n.position.x},${n.position.y}`).join('|');
  const [shownLayout, setShownLayout] = useState(layoutKey);
  useEffect(() => {
    if (layoutKey === shownLayout) return;
    const frame = requestAnimationFrame(() => {
      setShownLayout(layoutKey);
      void rf.fitView({ padding: 0.08, maxZoom: 1, duration: motionDuration(200) });
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, shownLayout, rf]);
  const ui: EditorUi = {
    graph: display.graph as WorkflowGraph,
    editingId: null,
    hoveredEdgeId: null,
    selectedEdgeId: null,
    issuesByNode: new Map(),
    previewing: true,
    openInsertMenu: noop,
    commitName: noop,
    cancelName: noop,
    hoverEdge: noop,
    assessments,
    openAssessment: onOpenAssessment,
  };

  // The Analysis tab stays mounted while hidden, so the diagram can start in an area with no size.
  // Fit the whole workflow again whenever its area changes size (shown, resized, full screen).
  useEffect(() => {
    const pane = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
    if (!pane || typeof ResizeObserver === 'undefined') return;
    let last = '';
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      const size = `${Math.round(width)}x${Math.round(height)}`;
      if (width < 1 || height < 1 || size === last) return;
      last = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void rf.fitView({ padding: 0.08, maxZoom: 1 }));
    });
    observer.observe(pane);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rf, label]);

  const revealKey = revealIds.join(',');
  useEffect(() => {
    if (!revealKey) return;
    const frame = requestAnimationFrame(() => {
      // Bring the steps into view without zooming in: pan if they fit, otherwise zoom out just enough.
      const zoom = rf.getZoom();
      const ids = revealKey.split(',');
      const box = rf.getNodesBounds(ids);
      const pane = document.querySelector(`[aria-label="${CSS.escape(label)}"]`)?.getBoundingClientRect();
      if (!pane) return;
      const { x, y } = rf.getViewport();
      const inView = box.x * zoom + x >= 0 && box.y * zoom + y >= 40 && (box.x + box.width) * zoom + x <= pane.width && (box.y + box.height) * zoom + y <= pane.height - 60;
      if (!inView) void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.5, maxZoom: zoom, duration: motionDuration(200) });
    });
    return () => cancelAnimationFrame(frame);
  }, [revealKey, rf, label]);

  return (
    <EditorUiContext.Provider value={ui}>
      <ReactFlow<StepFlowNode, FlowEdgeType>
        // A distinct id per diagram keeps arrowhead markers from clashing with the editor's.
        id={`review-${label.replace(/\W+/g, '-').toLowerCase()}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes: NodeChange<StepFlowNode>[]) => {
          const sized: Record<string, { width: number; height: number }> = {};
          for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sized[c.id] = c.dimensions;
          if (Object.keys(sized).length) setDims((d) => ({ ...d, ...sized }));
        }}
        onNodeClick={(_, node) => onSelectElement(node.id)}
        onEdgeClick={(_, edge) => onSelectElement(edge.id)}
        onKeyDown={(e) => {
          const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
          if (nodeEl && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelectElement(nodeEl.dataset.id!);
          }
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        // Low enough that long workflows still fit whole when the review opens.
        minZoom={0.1}
        maxZoom={1.5}
        fitView
        // Opens showing the whole workflow (owner choice); zoom, fit or Full screen to read long ones.
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        aria-label={label}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--fl-grid-dot)" bgColor="var(--fl-bg-page)" />
      </ReactFlow>
      <CanvasControls compact />
    </EditorUiContext.Provider>
  );
}
