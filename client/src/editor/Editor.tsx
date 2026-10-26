import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import type { WorkflowDetail } from '../../../shared/api';
import type { WorkflowGraph } from '../../../shared/graph';
import { preAnalysisCheck, validateWorkflow, type Issue } from '../../../shared/validation';
import { useAuth } from '../lib/auth';
import { useAutosave } from '../lib/useAutosave';
import { renameWorkflow, saveWorkflowGraph } from '../lib/workflows';
import { CanvasControls } from './CanvasControls';
import { ConnectDialog, DecisionDialog, DeleteStepDialog, ExceptionDialog, LoopDialog, ParallelDialog } from './dialogs';
import { EditorHeader } from './EditorHeader';
import { EditorUiContext, type EditorUi } from './EditorContext';
import { FlowEdge, type FlowEdgeType } from './FlowEdge';
import { useGraphHistory } from './history';
import { InsertMenu, type InsertChoice } from './InsertMenu';
import { autoLayout, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { focusWhenReady } from './focus';
import { motionDuration } from './motion';
import {
  addDecision,
  addException,
  addLoop,
  addParallel,
  connectSteps,
  connectTargets,
  deleteStep,
  deletionImpact,
  findNode,
  flowOut,
  GraphOpError,
  insertStep,
  joinSuggestions,
  loopTargets,
  openBranches,
  removeConnection,
  setPositions,
  slotAfter,
  slotDownstream,
  updateStep,
  type OpResult,
  type Slot,
} from './ops';
import { StepNode, type StepFlowNode } from './StepNode';
import { StepPopover } from './StepPopover';
import { STEP_META } from './stepMeta';
import { StepToolbar, type ToolbarAction } from './StepToolbar';
import { TOOLBAR_ICONS } from './toolbarIcons';
import { finishCandidate } from './finish';
import { FinishSuggestion } from './FinishSuggestion';

const nodeTypes = { step: StepNode };

/** Screen-reader hints that describe Flico's actual keys (not the diagram library's defaults). */
const ariaLabelConfig = {
  'node.a11yDescription.default': 'Press Enter to edit this step, Delete to remove it, Escape to close its details.',
  'node.a11yDescription.keyboardDisabled': 'Press Enter to edit this step, Delete to remove it, Escape to close its details.',
  'edge.a11yDescription.default': 'Use the add button on this connection to insert a step.',
};
const edgeTypes = { flow: FlowEdge };

type Dialog =
  | { kind: 'decision'; slot: Slot }
  | { kind: 'loop'; fromId: string }
  | { kind: 'parallel'; fromId: string }
  | { kind: 'exception'; nodeId: string }
  | { kind: 'delete'; nodeId: string }
  | { kind: 'connect'; fromId: string };

/** Lay out a loaded graph only if it has never been arranged (every step at the same spot). */
function initialGraph(g: WorkflowGraph): WorkflowGraph {
  const spots = new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`));
  return g.nodes.length > 1 && spots.size === 1 ? autoLayout(g) : g;
}

const nodeElement = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);

export function Editor({ workflow, onRenamed }: { workflow: WorkflowDetail; onRenamed: (name: string) => void }) {
  const { user } = useAuth();
  const rf = useReactFlow<StepFlowNode, FlowEdgeType>();
  const [initial] = useState(() => initialGraph(workflow.graph));
  const history = useGraphHistory(initial);
  const { graph, commit } = history;
  const save = useAutosave({
    value: graph,
    initialRevision: workflow.revision,
    save: (g, base) => saveWorkflowGraph(workflow.id, g, base),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; merge: boolean } | null>(null);
  const [insertMenu, setInsertMenu] = useState<{ slot: Slot; anchor: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const issues = useMemo(() => validateWorkflow(graph), [graph]);
  const analysisCheck = useMemo(() => preAnalysisCheck(graph), [graph]);
  const issuesByNode = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
    return map;
  }, [issues]);

  // Steps that disappeared (undo, delete) can't stay selected.
  const selected = selectedId && findNode(graph, selectedId) ? selectedId : null;
  const detailsNode = detailsId ? findNode(graph, detailsId) : undefined;
  const labelOf = useCallback((id: string) => findNode(graph, id)?.label || 'Untitled step', [graph]);

  /**
   * Bring steps into view after a change: pan only if they fit at the current zoom,
   * otherwise zoom out just enough. Optionally focus the first one.
   */
  const reveal = useCallback(
    (ids: string[], focusId?: string) => {
      requestAnimationFrame(() => {
        const box = document.querySelector('.react-flow')?.getBoundingClientRect();
        const bounds = (list: string[]) => {
          const nodes = list.map((id) => rf.getInternalNode(id)).filter((n) => n !== undefined);
          if (!nodes.length) return null;
          return {
            left: Math.min(...nodes.map((n) => n.internals.positionAbsolute.x)),
            top: Math.min(...nodes.map((n) => n.internals.positionAbsolute.y)),
            right: Math.max(...nodes.map((n) => n.internals.positionAbsolute.x + NODE_WIDTH)),
            bottom: Math.max(...nodes.map((n) => n.internals.positionAbsolute.y + (n.measured.height ?? NODE_HEIGHT))),
          };
        };
        const target = bounds(ids);
        const all = bounds(rf.getNodes().map((n) => n.id));
        if (target && all && box) {
          const { x, y, zoom } = rf.getViewport();
          // Keep clear of the toolbar (left), the hint text (top) and the controls (bottom).
          const view = { left: 110, top: 50, right: box.width - 80, bottom: box.height - 100 };
          type Box = NonNullable<typeof target>;
          const inView = (b: Box) =>
            b.left * zoom + x >= view.left && b.top * zoom + y >= view.top && b.right * zoom + x <= view.right && b.bottom * zoom + y <= view.bottom;
          const fits = (b: Box) => (b.right - b.left) * zoom <= view.right - view.left && (b.bottom - b.top) * zoom <= view.bottom - view.top;
          // Centre within the free area (between the toolbar and the right edge).
          const centre = (b: Box) =>
            void rf.setCenter(
              (b.left + b.right) / 2 - (view.left + view.right - box.width) / 2 / zoom,
              (b.top + b.bottom) / 2 - (view.top + view.bottom - box.height) / 2 / zoom,
              { zoom, duration: motionDuration(200) },
            );
          if (!inView(target)) {
            // Small workflows stay fully visible; larger ones pan to the change, zooming out only if needed.
            if (fits(all)) centre(all);
            else if (fits(target)) centre(target);
            else void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, maxZoom: zoom, duration: motionDuration(200) });
          }
        }
        if (focusId) focusWhenReady(() => nodeElement(focusId));
      });
    },
    [rf],
  );

  /** Run a graph operation as one undoable step, re-arranging the layout afterwards. */
  const apply = useCallback(
    (op: (g: WorkflowGraph) => OpResult, options: { editName?: boolean; select?: boolean } = {}): string | null => {
      try {
        const result = op(graph);
        commit(autoLayout(result.graph));
        setNotice(null);
        const added = result.graph.nodes.filter((n) => !findNode(graph, n.id)).map((n) => n.id);
        if (result.focusId && options.select !== false) {
          setSelectedId(result.focusId);
          setDetailsId(null);
          if (options.editName) setEditing({ id: result.focusId, merge: true });
          reveal([result.focusId, ...added], options.editName ? undefined : result.focusId);
        } else if (added.length) {
          reveal(added);
        }
        return null;
      } catch (error) {
        if (error instanceof GraphOpError) {
          setNotice(error.message);
          return error.message;
        }
        throw error;
      }
    },
    [graph, commit, reveal],
  );

  const insertAt = (slot: Slot, choice: InsertChoice) => {
    setInsertMenu(null);
    if (choice === 'decision') setDialog({ kind: 'decision', slot });
    else apply((g) => insertStep(g, slot, choice), { editName: true });
  };

  const ui: EditorUi = {
    graph,
    editingId: editing?.id ?? null,
    hoveredEdgeId,
    selectedEdgeId: null,
    issuesByNode,
    openInsertMenu: (slot, anchor) => setInsertMenu({ slot, anchor }),
    commitName: (id, label) => {
      const node = findNode(graph, id);
      const trimmed = label.trim();
      if (node && trimmed && trimmed !== node.label) commit(updateStep(graph, id, { label: trimmed }).graph, editing?.merge ?? false);
      setEditing(null);
      focusWhenReady(() => nodeElement(id));
    },
    cancelName: () => {
      const id = editing?.id;
      setEditing(null);
      if (id) focusWhenReady(() => nodeElement(id));
    },
    hoverEdge: (id) => {
      clearTimeout(hoverTimer.current);
      if (id) setHoveredEdgeId(id);
      else hoverTimer.current = setTimeout(() => setHoveredEdgeId(null), 250);
    },
  };

  // ---------- React Flow view of the graph ----------

  const rfNodes: StepFlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const problems = issuesByNode.get(n.id) ?? [];
        return {
          id: n.id,
          type: 'step',
          position: dragging[n.id] ?? n.position,
          data: { step: n },
          selected: n.id === selected,
          measured: dims[n.id],
          ariaLabel: `${STEP_META[n.type].name} step: ${n.label || 'Untitled step'}${problems.length ? `. ${problems.map((p) => p.message).join(' ')}` : ''}`,
        };
      }),
    [graph, selected, dims, dragging, issuesByNode],
  );

  const rfEdges: FlowEdgeType[] = useMemo(() => {
    return graph.edges.map((e): FlowEdgeType => {
      const isLoop = e.type === 'loop';
      let loopBottom: number | undefined;
      if (isLoop) {
        const s = findNode(graph, e.sourceId)?.position;
        const t = findNode(graph, e.targetId)?.position;
        if (s && t) {
          const [minX, maxX] = [Math.min(s.x, t.x) - 40, Math.max(s.x, t.x) + NODE_WIDTH + 40];
          const between = graph.nodes.filter((n) => n.position.x + NODE_WIDTH > minX && n.position.x < maxX);
          loopBottom = Math.max(...between.map((n) => n.position.y + (dims[n.id]?.height ?? NODE_HEIGHT))) + 40;
        }
      }
      const colour = e.type === 'exception' ? 'var(--fl-exception-stroke)' : 'var(--fl-edge)';
      const kind = e.type === 'yes' || e.type === 'no' ? `, ${e.label ?? e.type}` : e.type === 'loop' ? ', repeats' : e.type === 'exception' ? ', exception path' : '';
      return {
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        type: 'flow',
        sourceHandle: isLoop ? 'loop-out' : 'out',
        targetHandle: isLoop ? 'loop-in' : 'in',
        markerEnd: { type: MarkerType.Arrow, color: colour, width: 18, height: 18, strokeWidth: 1.6 },
        ariaLabel: `Connection from ${labelOf(e.sourceId)} to ${labelOf(e.targetId)}${kind}`,
        data: { edge: e, sourceLabel: labelOf(e.sourceId), targetLabel: labelOf(e.targetId), ...(loopBottom !== undefined ? { loopBottom } : {}) },
      };
    });
  }, [graph, dims, labelOf]);

  const onNodesChange = useCallback(
    (changes: NodeChange<StepFlowNode>[]) => {
      const sized: Record<string, { width: number; height: number }> = {};
      const moving: Record<string, { x: number; y: number }> = {};
      const moved: Record<string, { x: number; y: number }> = {};
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions) sized[c.id] = c.dimensions;
        if (c.type === 'position' && c.position) (c.dragging ? moving : moved)[c.id] = c.position;
      }
      if (Object.keys(sized).length) setDims((d) => ({ ...d, ...sized }));
      if (Object.keys(moving).length) setDragging((d) => ({ ...d, ...moving }));
      if (Object.keys(moved).length) {
        // Drag finished (or moved with arrow keys): positions only, connections unchanged.
        commit(setPositions(graph, moved));
        setDragging({});
      }
    },
    [graph, commit],
  );

  // ---------- keyboard ----------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return; // native text undo
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history]);

  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
    if (!nodeEl || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    const id = nodeEl.dataset.id!;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedId(id);
      setDetailsId(id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && findNode(graph, id)?.type !== 'start') {
      e.preventDefault();
      setSelectedId(id);
      setDialog({ kind: 'delete', nodeId: id });
    } else if (e.key === 'Escape') {
      // Close the details first, then clear the selection. React Flow blurs the step on Escape; keep focus on it.
      if (detailsId) setDetailsId(null);
      else setSelectedId(null);
      nodeEl.focus({ preventScroll: true });
    }
  };

  // ---------- toolbar ----------

  const toolbar: ToolbarAction[] = (() => {
    const none = 'Select a step first.';
    const slot = selected ? slotAfter(graph, selected) : { reason: none };
    const stepAction = (type: InsertChoice, label: string): ToolbarAction => ({
      id: type,
      label,
      icon: TOOLBAR_ICONS[type],
      ...('reason' in slot ? { disabledReason: slot.reason } : type === 'finish' && slot.slot.kind === 'edge' ? { disabledReason: 'Finish can only end a path.' } : {}),
      onClick: () => 'slot' in slot && insertAt(slot.slot, type),
    });
    const node = selected ? findNode(graph, selected) : undefined;
    const loopReason = !node ? none : loopTargets(graph, node.id).length === 0 ? 'There is no earlier step to go back to.' : undefined;
    const parallelReason = !node
      ? none
      : node.type === 'decision' || node.type === 'finish'
        ? 'Choose a regular step (not a decision or Finish).'
        : flowOut(graph, node.id).length > 1
          ? 'This step already splits into several paths.'
          : undefined;
    const exceptionReason = !node ? none : node.type === 'start' || node.type === 'finish' ? 'Choose a step between Start and Finish.' : undefined;
    return [
      stepAction('action', 'Add action'),
      stepAction('decision', 'Add decision'),
      stepAction('approval', 'Add approval'),
      stepAction('wait', 'Add wait'),
      stepAction('finish', 'Add finish'),
      { id: 'loop', label: 'Repeat earlier step', icon: TOOLBAR_ICONS.loop, ...(loopReason ? { disabledReason: loopReason } : {}), onClick: () => node && setDialog({ kind: 'loop', fromId: node.id }) },
      { id: 'parallel', label: 'Parallel activities', icon: TOOLBAR_ICONS.parallel, ...(parallelReason ? { disabledReason: parallelReason } : {}), onClick: () => node && setDialog({ kind: 'parallel', fromId: node.id }) },
      { id: 'exception', label: 'Add exception', icon: TOOLBAR_ICONS.exception, ...(exceptionReason ? { disabledReason: exceptionReason } : {}), onClick: () => node && setDialog({ kind: 'exception', nodeId: node.id }) },
    ];
  })();

  const showIssue = (issue: Issue) => {
    const id = issue.nodeId ?? (issue.edgeId ? graph.edges.find((e) => e.id === issue.edgeId)?.sourceId : undefined);
    if (!id) return;
    setSelectedId(id);
    setDetailsId(null);
    reveal([id], id);
  };

  const closeDialog = () => setDialog(null);
  const finishAfter = finishCandidate(graph);

  return (
    <EditorUiContext.Provider value={ui}>
      <div className="flex h-screen flex-col bg-fl-page">
        <EditorHeader
          email={user!.email}
          name={workflow.name}
          onRename={async (name) => {
            await renameWorkflow(workflow.id, name);
            onRenamed(name);
          }}
          save={save}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          issues={issues}
          onShowIssue={showIssue}
          analysisCheck={analysisCheck}
        />

        <div className="relative flex-1" onKeyDown={onCanvasKeyDown}>
          <ReactFlow<StepFlowNode, FlowEdgeType>
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              setDetailsId(node.id);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setDetailsId(null);
            }}
            onEdgeMouseEnter={(_, edge: Edge) => ui.hoverEdge(edge.id)}
            onEdgeMouseLeave={() => ui.hoverEdge(null)}
            nodesConnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            zoomOnDoubleClick={false}
            minZoom={0.25}
            maxZoom={1.5}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            aria-label="Workflow diagram"
            ariaLabelConfig={ariaLabelConfig}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--fl-grid-dot)" bgColor="var(--fl-bg-page)" />
          </ReactFlow>

          <p className="pointer-events-none absolute left-8 top-5 text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-muted">Workflow editor</p>
          <p className="pointer-events-none absolute right-8 top-5 text-[12px] text-fl-text-muted">Changes save automatically · Drag the canvas to pan</p>

          <StepToolbar actions={toolbar} />
          <CanvasControls
            onAutoArrange={() => {
              commit(autoLayout(graph));
              requestAnimationFrame(() => void rf.fitView({ padding: 0.25, maxZoom: 1, duration: motionDuration(200) }));
            }}
          />
          {finishAfter && (
            <FinishSuggestion
              workflowId={workflow.id}
              afterLabel={labelOf(finishAfter)}
              onAdd={() => apply((g) => insertStep(g, { kind: 'after', nodeId: finishAfter }, 'finish'))}
            />
          )}
          {notice && (
            <div role="alert" className="absolute bottom-6 left-1/2 z-20 flex max-w-[520px] -translate-x-1/2 items-center gap-3 rounded-[12px] border border-[var(--fl-exception-stroke)] bg-[var(--fl-exception-fill)] px-4 py-2.5 text-[13px] text-[var(--fl-exception-ink)] shadow-fl-card">
              {notice}
              <button type="button" className="fl-link text-[13px]" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      {insertMenu && (
        <InsertMenu
          anchor={insertMenu.anchor}
          finishAllowed={insertMenu.slot.kind !== 'edge'}
          onChoose={(type) => insertAt(insertMenu.slot, type)}
          onClose={() => setInsertMenu(null)}
        />
      )}

      {detailsNode && !dialog && (
        <StepPopover
          key={detailsNode.id}
          graph={graph}
          node={detailsNode}
          anchor={() => nodeElement(detailsNode.id)}
          onChange={(patch) => apply((g) => updateStep(g, detailsNode.id, patch), { select: false })}
          onClose={(returnFocus) => {
            setDetailsId(null);
            if (returnFocus) nodeElement(detailsNode.id)?.focus({ preventScroll: true });
          }}
          onDelete={() => setDialog({ kind: 'delete', nodeId: detailsNode.id })}
          onConnect={() => setDialog({ kind: 'connect', fromId: detailsNode.id })}
          onRemoveConnection={(edgeId) => apply((g) => removeConnection(g, edgeId), { select: false })}
        />
      )}

      {dialog?.kind === 'decision' && (
        <DecisionDialog
          downstreamLabel={(() => {
            const d = slotDownstream(graph, dialog.slot);
            return d ? labelOf(d) : undefined;
          })()}
          onCancel={closeDialog}
          onConfirm={(input) => apply((g) => addDecision(g, dialog.slot, input)) ?? (closeDialog(), null)}
        />
      )}
      {dialog?.kind === 'loop' && (
        <LoopDialog
          fromLabel={labelOf(dialog.fromId)}
          targets={loopTargets(graph, dialog.fromId)}
          onCancel={closeDialog}
          onConfirm={(target, condition) => apply((g) => addLoop(g, dialog.fromId, target, condition)) ?? (closeDialog(), null)}
        />
      )}
      {dialog?.kind === 'parallel' && (
        <ParallelDialog
          fromLabel={labelOf(dialog.fromId)}
          continuesTo={(() => {
            const next = flowOut(graph, dialog.fromId)[0];
            return next ? labelOf(next.targetId) : undefined;
          })()}
          onCancel={closeDialog}
          onConfirm={(input) => apply((g) => addParallel(g, dialog.fromId, input)) ?? (closeDialog(), null)}
        />
      )}
      {dialog?.kind === 'exception' && (
        <ExceptionDialog
          stepLabel={labelOf(dialog.nodeId)}
          onCancel={closeDialog}
          onConfirm={(input) => apply((g) => addException(g, dialog.nodeId, input)) ?? (closeDialog(), null)}
        />
      )}
      {dialog?.kind === 'delete' && findNode(graph, dialog.nodeId) && (
        <DeleteStepDialog
          impact={deletionImpact(graph, dialog.nodeId)}
          labelOf={labelOf}
          onCancel={closeDialog}
          onConfirm={(reconnect) => {
            const id = dialog.nodeId;
            closeDialog();
            setDetailsId(null);
            setSelectedId(null);
            apply((g) => deleteStep(g, id, { reconnect }), { select: false });
          }}
        />
      )}
      {dialog?.kind === 'connect' && (
        <ConnectDialog
          fromLabel={labelOf(dialog.fromId)}
          suggestions={joinSuggestions(graph, dialog.fromId)}
          targets={connectTargets(graph, dialog.fromId)}
          branches={openBranches(graph, dialog.fromId)}
          onCancel={closeDialog}
          onConfirm={(target, branch) => apply((g) => connectSteps(g, dialog.fromId, target, undefined, branch), { select: false }) ?? (closeDialog(), null)}
        />
      )}
    </EditorUiContext.Provider>
  );
}
