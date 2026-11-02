import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useLocation, useNavigate } from 'react-router';
import { quickRepeatBlocked } from '../../../shared/analysis';
import type { AiSource, Analysis, AnalysisMode, ApplyAnalysisResponse, Assumption, ChatMessage, ChatMode, StartAnalysisRequest, WorkflowDetail } from '../../../shared/api';
import { applyOperations, diffGraphs, type GraphChanges } from '../../../shared/aiOps';
import type { WorkflowGraph } from '../../../shared/graph';
import { preAnalysisCheck, validateWorkflow, type Issue } from '../../../shared/validation';
import { useAuth } from '../lib/auth';
import { useAutosave } from '../lib/useAutosave';
import { useFullscreen } from '../lib/useFullscreen';
import { renameWorkflow, saveWorkflowGraph } from '../lib/workflows';
import { applyProposal, cancelProposal, createAiDraft, fetchAiStatus, quickAddStep, removeAssumption, updateAssumption } from '../lib/ai';
import { AskFlico } from './AskFlico';
import { AssumptionsPanel, DraftNotice, PreviewBar } from './AiPanels';
import { useChat, type ChatRequest } from './useChat';
import { cancelRun, fetchAnalyses, fetchCredits, fetchQuestions, fetchRun, startAnalysis } from '../lib/analysis';
import { AnalysisView } from './analysis/AnalysisView';
import { AnalysisProgress, GuidedQuestions, type ProgressState } from './analysis/AnalysisDialogs';
import { CanvasControls } from './CanvasControls';
import { ConnectDialog, DecisionDialog, DeleteStepDialog, ExceptionDialog, LoopDialog, ParallelDialog } from './dialogs';
import { EditorHeader } from './EditorHeader';
import { EditorUiContext, type EditorUi } from './EditorContext';
import { FlowEdge, type FlowEdgeType } from './FlowEdge';
import { useGraphHistory } from './history';
import { InsertMenu, type InsertChoice } from './InsertMenu';
import { autoLayout, NODE_HEIGHT, NODE_WIDTH, placeNewSteps } from './layout';
import { focusWhenReady } from './focus';
import { flowEdges, flowNodes, withChanges } from './flowElements';
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
  type StepPatch,
} from './ops';
import { StepNode, type StepFlowNode } from './StepNode';
import { StepPopover } from './StepPopover';
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

type Preview = { messageId: string; graph: WorkflowGraph; changes: GraphChanges };
export type AiDraftState = { aiDraft?: { partial: boolean; source: AiSource; description: string } };

const PREVIEW_REASON = 'Apply or cancel the suggestion first.';

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
  /** Where the block-details card was dragged (kept for this editor session only). */
  const [detailsPosition, setDetailsPosition] = useState<{ left: number; top: number } | null>(null);
  /** Details edits of one card session are a single undo step. */
  const [detailsSession, setDetailsSession] = useState<{ nodeId: string; committed: boolean } | null>(null);
  const [editing, setEditing] = useState<{ id: string; merge: boolean } | null>(null);
  const [insertMenu, setInsertMenu] = useState<{ slot: Slot; anchor: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---------- AI state ----------
  const location = useLocation();
  const navigate = useNavigate();
  const [ai, setAi] = useState<{ available: boolean; source: AiSource | null } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState<{ stepId: string; stepLabel: string } | null>(null);
  const chat = useChat(workflow.id, chatOpen);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [assumptions, setAssumptions] = useState<Assumption[]>(workflow.assumptions);
  const [assumptionsCollapsed, setAssumptionsCollapsed] = useState(false);
  const [draftNotice, setDraftNotice] = useState(() => {
    const draft = (location.state as AiDraftState | null)?.aiDraft;
    return draft && (draft.partial || draft.source === 'fixture') ? draft : null;
  });
  const [redrafting, setRedrafting] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [toast, setToast] = useState<{ text: string; after: WorkflowGraph } | null>(null);
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  });

  useEffect(() => {
    let active = true;
    fetchAiStatus().then(
      (status) => active && setAi({ available: status.available, source: status.source }),
      () => active && setAi({ available: false, source: null }),
    );
    return () => {
      active = false;
    };
  }, []);

  const fullscreen = useFullscreen();
  const { exit: exitFullscreen } = fullscreen;
  // Leaving the editor also leaves full screen.
  useEffect(() => () => void exitFullscreen(), [exitFullscreen]);

  // ---------- analysis ----------
  const [view, setView] = useState<'editor' | 'analysis'>('editor');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [credits, setCredits] = useState<{ balance: number; initial: number } | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const run = useRef<{ id: string | null; request: Omit<StartAnalysisRequest, 'baseRevision'> } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let active = true;
    fetchAnalyses(workflow.id).then(
      (list) => active && setAnalyses(list),
      () => {},
    );
    fetchCredits().then(
      (c) => active && setCredits(c),
      () => {},
    );
    return () => {
      active = false;
      alive.current = false;
    };
  }, [workflow.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 10_000);
    return () => clearTimeout(timer);
  }, [toast]);

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
          // Ask Flico floats over the canvas: keep changes clear of it when it sits on the right.
          const chatBox = document.querySelector('.fl-chat')?.getBoundingClientRect();
          if (chatBox && chatBox.height > 60 && chatBox.left > box.left + box.width / 2) view.right = Math.min(view.right, chatBox.left - box.left - 24);
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

  /** Run a graph operation as one undoable step. New steps are placed; nothing else is re-arranged. */
  const apply = useCallback(
    (op: (g: WorkflowGraph) => OpResult, options: { editName?: boolean; select?: boolean; onCommitted?: (g: WorkflowGraph) => void } = {}): string | null => {
      try {
        const result = op(graph);
        const next = placeNewSteps(graph, result.graph);
        commit(next);
        options.onCommitted?.(next);
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

  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  /** AI Quick Add: the one AI action that changes the graph immediately (undoable), because the person chose the spot. */
  const quickAdd = async (slot: Slot, text: string): Promise<string | null> => {
    const g = graphRef.current;
    const from = slot.kind === 'edge' ? g.edges.find((e) => e.id === slot.edgeId)?.sourceId : slot.nodeId;
    const to = slot.kind === 'edge' ? g.edges.find((e) => e.id === slot.edgeId)?.targetId : undefined;
    try {
      const { step, source } = await quickAddStep(workflow.id, {
        text,
        finishAllowed: slot.kind !== 'edge',
        ...(from ? { previousLabel: findNode(g, from)?.label ?? '' } : {}),
        ...(to ? { nextLabel: findNode(g, to)?.label ?? '' } : {}),
      });
      setInsertMenu(null);
      const inferred = { origin: 'ai-inferred' as const, assumptionStatus: 'unconfirmed' as const };
      const error = applyRef.current(
        (current) => {
          const result = step.type === 'decision' ? addDecision(current, slot, { question: step.label }) : insertStep(current, slot, step.type);
          const id = result.focusId!;
          return { ...result, graph: { ...result.graph, nodes: result.graph.nodes.map((n) => (n.id === id ? { ...n, label: step.label, ...inferred } : n)) } };
        },
        {
          onCommitted: (after) =>
            setToast({ text: `Added “${step.label}” with Quick Add${source === 'fixture' ? ' (test fixture, not live AI)' : ''}.`, after }),
        },
      );
      return error;
    } catch (error) {
      return (error as Error).message;
    }
  };

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
    previewing: preview !== null,
    openInsertMenu: (slot, anchor) => !preview && setInsertMenu({ slot, anchor }),
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

  /** What the canvas shows: the graph, or during an AI preview the proposed graph plus what it removes. */
  const display = useMemo(
    () => (preview ? withChanges(graph, preview.graph, preview.changes) : { graph, nodeChange: new Map(), edgeChange: new Map() }),
    [graph, preview],
  );

  const rfNodes: StepFlowNode[] = useMemo(
    () => flowNodes(display, { dims, dragging, selected: preview ? null : selected, ...(preview ? {} : { issuesByNode }) }),
    [display, preview, selected, dims, dragging, issuesByNode],
  );

  const rfEdges: FlowEdgeType[] = useMemo(() => flowEdges(display, { dims, dragging }), [display, dims, dragging]);

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
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || preview) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return; // native text undo
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, preview]);

  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
    if (preview || !nodeEl || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    const id = nodeEl.dataset.id!;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetails(id);
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
    const actions: ToolbarAction[] = [
      {
        id: 'details',
        label: 'Edit details',
        icon: TOOLBAR_ICONS.details,
        ...(node ? {} : { disabledReason: none }),
        onClick: () => node && openDetails(node.id),
      },
      stepAction('action', 'Add action'),
      stepAction('decision', 'Add decision'),
      stepAction('approval', 'Add approval'),
      stepAction('wait', 'Add wait'),
      stepAction('finish', 'Add finish'),
      { id: 'loop', label: 'Repeat earlier step', icon: TOOLBAR_ICONS.loop, ...(loopReason ? { disabledReason: loopReason } : {}), onClick: () => node && setDialog({ kind: 'loop', fromId: node.id }) },
      { id: 'parallel', label: 'Parallel activities', icon: TOOLBAR_ICONS.parallel, ...(parallelReason ? { disabledReason: parallelReason } : {}), onClick: () => node && setDialog({ kind: 'parallel', fromId: node.id }) },
      { id: 'exception', label: 'Add exception', icon: TOOLBAR_ICONS.exception, ...(exceptionReason ? { disabledReason: exceptionReason } : {}), onClick: () => node && setDialog({ kind: 'exception', nodeId: node.id }) },
    ];
    return preview ? actions.map((a) => ({ ...a, disabledReason: PREVIEW_REASON })) : actions;
  })();

  const openDetails = (id: string) => {
    setSelectedId(id);
    setDetailsId(id);
    setDetailsSession({ nodeId: id, committed: false });
  };

  /** A details edit: the first of a card session is a new undo step, later ones fold into it. */
  const commitDetails = (id: string, patch: StepPatch): WorkflowGraph | null => {
    const current = graphRef.current;
    const node = findNode(current, id);
    if (!node || Object.entries(patch).every(([k, v]) => JSON.stringify(node[k as keyof typeof node]) === JSON.stringify(v))) return null;
    try {
      const next = updateStep(current, id, patch).graph;
      const merge = detailsSession?.nodeId === id && detailsSession.committed;
      if (detailsSession?.nodeId === id && !detailsSession.committed) setDetailsSession({ nodeId: id, committed: true });
      commit(next, merge);
      return next;
    } catch (error) {
      if (error instanceof GraphOpError) setNotice(error.message);
      else throw error;
      return null;
    }
  };

  /** This step's details are "saved" only when the server's last acknowledged graph has them. */
  const detailsSaveState = (id: string): 'saving' | 'saved' | 'error' => {
    const now = findNode(graph, id);
    const persisted = findNode(save.saved, id);
    const same = now && persisted && JSON.stringify({ ...now, position: null }) === JSON.stringify({ ...persisted, position: null });
    if (same) return 'saved';
    return save.status === 'error' || save.status === 'conflict' ? 'error' : 'saving';
  };

  const showIssue = (issue: Issue) => {
    const id = issue.nodeId ?? (issue.edgeId ? graph.edges.find((e) => e.id === issue.edgeId)?.sourceId : undefined);
    if (!id) return;
    setSelectedId(id);
    setDetailsId(null);
    reveal([id], id);
  };

  // ---------- Ask Flico and AI proposals ----------

  /** Show a proposal on the canvas without changing the workflow. */
  const startPreview = async (message: ChatMessage) => {
    const proposal = message.proposal;
    if (!proposal || proposal.status !== 'pending' || proposalBusy) return;
    setProposalBusy(true);
    try {
      const revision = await save.flushNow();
      const current = graphRef.current;
      if (revision !== proposal.baseRevision) {
        setNotice('The workflow changed after this suggestion was made, so it can’t be previewed. Ask Flico again for an updated suggestion.');
        return;
      }
      const result = applyOperations(current, proposal.operations);
      if (!result.ok) {
        setNotice('This suggestion no longer fits the workflow. Ask Flico again.');
        return;
      }
      const placed = placeNewSteps(current, result.graph);
      const changes = diffGraphs(current, placed);
      setInsertMenu(null);
      setDialog(null);
      setDetailsId(null);
      setEditing(null);
      setSelectedId(null);
      setNotice(null);
      setPreview({ messageId: message.id, graph: placed, changes });
      reveal([...changes.addedNodes, ...changes.modifiedNodes, ...changes.removedNodes]);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setProposalBusy(false);
    }
  };

  /** Apply the previewed proposal: one server-checked, all-or-nothing change and one undoable step. */
  const applyPreview = async () => {
    if (!preview || proposalBusy) return;
    setProposalBusy(true);
    try {
      await save.flushNow();
      const result = await applyProposal(workflow.id, preview.messageId);
      save.rebase(result.graph, result.revision);
      commit(result.graph);
      chat.replace(result.message);
      const added = preview.changes.addedNodes;
      setPreview(null);
      if (added.length) reveal(added);
    } catch (error) {
      setPreview(null);
      setNotice((error as Error).message);
      void chat.reload();
    } finally {
      setProposalBusy(false);
    }
  };

  const cancelSuggestion = async (message: ChatMessage) => {
    if (preview?.messageId === message.id) setPreview(null);
    try {
      chat.replace(await cancelProposal(workflow.id, message.id));
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const askFlico = async (request: ChatRequest) => {
    const added = await chat.send(request, save.flushNow);
    const reply = added?.find((m) => m.role === 'assistant');
    if (reply?.proposal?.status === 'pending') await startPreview(reply);
  };

  const openChat = (context: { stepId: string; stepLabel: string } | null = null) => {
    setChatContext(context);
    setChatOpen(true);
    setAssumptionsCollapsed(true);
  };

  const closeChat = () => {
    setChatOpen(false);
    document.querySelector<HTMLElement>('[data-ask-flico]')?.focus();
  };

  const retryDraft = async () => {
    if (!draftNotice) return;
    setRedrafting({ busy: true, error: null });
    try {
      const result = await createAiDraft(draftNotice.description);
      const state: AiDraftState = { aiDraft: { partial: result.partial, source: result.source, description: draftNotice.description } };
      navigate(`/workflows/${result.workflow.id}`, { state });
    } catch (error) {
      setRedrafting({ busy: false, error: (error as Error).message });
    }
  };

  const assumptionAction = (action: () => Promise<Assumption[]>) => async () => setAssumptions(await action());

  // ---------- analysis runs ----------

  /**
   * Run an analysis: save pending edits, start it, and follow its real stages until it finishes.
   * Retrying after a lost request reuses the same key, so the server never runs or charges twice.
   */
  const runAnalysis = async (request: Omit<StartAnalysisRequest, 'baseRevision'>) => {
    run.current = { id: null, request };
    setProgress({ kind: 'running', stage: 'checking', cancelling: false });
    try {
      const baseRevision = await save.flushNow();
      let current = await startAnalysis(workflow.id, { ...request, baseRevision });
      run.current = { id: current.id, request };
      while (current.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (!alive.current) return;
        current = await fetchRun(current.id);
        const stage = current.stage;
        if (current.status === 'running') setProgress((p) => (p?.kind === 'running' ? { ...p, stage } : p));
      }
      if (current.status === 'succeeded') {
        const [list, balance] = await Promise.all([fetchAnalyses(workflow.id), fetchCredits()]);
        setAnalyses(list);
        setCredits(balance);
        setProgress(null);
        setView('analysis');
      } else if (current.status === 'cancelled') {
        setProgress({ kind: 'cancelled' });
      } else {
        setProgress({ kind: 'failed', message: current.error ?? 'The analysis did not finish. No credit was used.' });
      }
      void fetchCredits().then(setCredits, () => {});
    } catch (error) {
      setProgress({ kind: 'failed', message: (error as Error).message });
    }
  };

  const startNew = (mode: AnalysisMode, answers: StartAnalysisRequest['answers'] = []) =>
    void runAnalysis({ mode, idempotencyKey: crypto.randomUUID(), ...(mode === 'guided' ? { answers } : {}) });

  const retryAnalysis = () => {
    const last = run.current;
    if (!last) return;
    // The server never saw a run id: the request may have been lost, so retry it as the same request.
    if (last.id === null) void runAnalysis(last.request);
    else startNew(last.request.mode, last.request.answers);
  };

  const cancelAnalysis = async () => {
    const id = run.current?.id;
    setProgress((p) => (p?.kind === 'running' ? { ...p, cancelling: true } : p));
    if (!id) return;
    try {
      await cancelRun(id);
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const onAnalysisApplied = (result: ApplyAnalysisResponse) => {
    save.rebase(result.graph, result.revision);
    commit(result.graph);
    setAnalyses((list) => list.map((a) => (a.id === result.analysis.id ? result.analysis : a)));
    setView('editor');
    const added = result.graph.nodes.filter((n) => !findNode(graph, n.id)).map((n) => n.id);
    if (added.length) reveal(added);
  };

  const { flushNow } = save;
  // Stable, so the questions are fetched once per opening of the dialog.
  const guidedQuestions = useCallback(async () => fetchQuestions(workflow.id, await flushNow()), [workflow.id, flushNow]);

  const analyzeBlocked =
    ai === null ? 'Checking AI…' : !ai.available ? 'AI not set up' : progress?.kind === 'running' ? 'An analysis is running' : preview ? 'Apply or cancel the suggestion first' : null;

  const closeDialog = () => setDialog(null);
  const finishAfter = preview ? null : finishCandidate(graph);

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
          canUndo={history.canUndo && !preview}
          canRedo={history.canRedo && !preview}
          onUndo={history.undo}
          onRedo={history.redo}
          issues={issues}
          onShowIssue={showIssue}
          analysisCheck={analysisCheck}
          aiAvailable={ai?.available ?? false}
          chatOpen={chatOpen}
          onToggleChat={() => (chatOpen ? closeChat() : openChat())}
          view={view}
          hasAnalysis={analyses.length > 0}
          onViewChange={setView}
          analyze={{
            credits: credits?.balance ?? null,
            initialCredits: credits?.initial ?? null,
            disabledReason: analyzeBlocked,
            quickBlockedReason: quickRepeatBlocked(currentAnalysisOf(analyses), graph) ? 'Unchanged since last analysis' : null,
            onQuick: () => startNew('quick'),
            onGuided: () => setGuidedOpen(true),
            onViewAnalysis: () => setView('analysis'),
          }}
          onSuggestFix={() => {
            openChat();
            void askFlico({ content: 'Fix the issues in this workflow', mode: 'fix' });
          }}
        />

        {progress && (
          // Over the content area of either tab (Editor or Analysis), below the header, so a running,
          // failed or cancelled analysis is always visible wherever it was started from.
          <div className="fixed inset-x-0 bottom-0 top-[var(--fl-header-height)] z-40" data-testid="analysis-progress-layer">
            <AnalysisProgress
              state={progress}
              onCancel={() => void cancelAnalysis()}
              onRetry={retryAnalysis}
              onClose={() => setProgress(null)}
            />
          </div>
        )}
        {analyses.length > 0 && (
          <div className={view === 'analysis' ? 'min-h-0 flex-1' : 'hidden'}>
            <AnalysisView
              analyses={analyses}
              currentGraph={graph}
              onAnalysisChange={(a) => setAnalyses((list) => list.map((x) => (x.id === a.id ? a : x)))}
              onApplied={onAnalysisApplied}
              onBackToEditor={() => setView('editor')}
            />
          </div>
        )}
        <div className={view === 'analysis' ? 'hidden' : 'relative flex-1'} onKeyDown={onCanvasKeyDown}>
          <ReactFlow<StepFlowNode, FlowEdgeType>
            id="editor"
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            // One click selects (the step toolbar acts on it); a double-click opens the details card.
            onNodeClick={(_, node) => {
              if (preview) return;
              setSelectedId(node.id);
              if (detailsId && detailsId !== node.id) setDetailsId(null);
            }}
            onNodeDoubleClick={(_, node) => {
              if (preview) return;
              openDetails(node.id);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setDetailsId(null);
            }}
            onEdgeMouseEnter={(_, edge: Edge) => ui.hoverEdge(edge.id)}
            onEdgeMouseLeave={() => ui.hoverEdge(null)}
            nodesConnectable={false}
            nodesDraggable={!preview}
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
            {...(fullscreen.supported ? { fullscreen: { active: fullscreen.active, onToggle: () => void (fullscreen.active ? fullscreen.exit() : fullscreen.enter()) } } : {})}
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
          {assumptions.length > 0 && !preview && (
            <AssumptionsPanel
              assumptions={assumptions}
              collapsed={assumptionsCollapsed}
              onToggle={() => setAssumptionsCollapsed(!assumptionsCollapsed)}
              onConfirm={(id) => assumptionAction(() => updateAssumption(workflow.id, id, { status: 'confirmed' }))()}
              onEdit={(id, text) => assumptionAction(() => updateAssumption(workflow.id, id, { text }))()}
              onRemove={(id) => assumptionAction(() => removeAssumption(workflow.id, id))()}
              onShowSteps={(ids) => {
                const present = ids.filter((id) => findNode(graph, id));
                if (present[0]) {
                  setSelectedId(present[0]);
                  reveal(present, present[0]);
                }
              }}
            />
          )}
          {draftNotice && !preview && (
            <DraftNotice
              partial={draftNotice.partial}
              fixture={draftNotice.source === 'fixture'}
              retrying={redrafting.busy}
              retryError={redrafting.error}
              onRetry={() => void retryDraft()}
              onDismiss={() => setDraftNotice(null)}
            />
          )}
          {preview && <PreviewBar changes={preview.changes} busy={proposalBusy} onApply={() => void applyPreview()} onCancel={() => {
            const message = chat.messages?.find((m) => m.id === preview.messageId);
            if (message) void cancelSuggestion(message);
            else setPreview(null);
          }} />}
          {toast && !notice && (
            <div role="status" className="absolute bottom-6 left-1/2 z-20 flex max-w-[560px] -translate-x-1/2 items-center gap-3 rounded-[12px] border border-fl-border bg-white px-4 py-2.5 text-[13px] text-fl-text shadow-fl-float">
              {toast.text}
              <button
                type="button"
                className="fl-link text-[13px]"
                onClick={() => {
                  if (graphRef.current === toast.after) history.undo();
                  setToast(null);
                }}
              >
                Undo
              </button>
            </div>
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
          quickAdd={{
            ...(ai === null ? { disabledReason: 'Checking AI availability…' } : !ai.available ? { disabledReason: "AI isn't set up on this server. Choose a step type above." } : {}),
            onSubmit: (text) => quickAdd(insertMenu.slot, text),
          }}
        />
      )}

      {detailsNode && !dialog && (
        <StepPopover
          key={detailsNode.id}
          graph={graph}
          node={detailsNode}
          anchor={() => nodeElement(detailsNode.id)}
          onChange={(patch) => void commitDetails(detailsNode.id, patch)}
          saveState={detailsSaveState(detailsNode.id)}
          saveError={save.error}
          onRetry={save.retry}
          onDone={async (patch) => {
            const next = (patch && commitDetails(detailsNode.id, patch)) ?? undefined;
            try {
              await save.flushNow(next);
              return true;
            } catch {
              return false;
            }
          }}
          position={detailsPosition}
          onMove={setDetailsPosition}
          onClose={(returnFocus) => {
            setDetailsId(null);
            if (returnFocus) nodeElement(detailsNode.id)?.focus({ preventScroll: true });
          }}
          onDelete={() => setDialog({ kind: 'delete', nodeId: detailsNode.id })}
          onConnect={() => setDialog({ kind: 'connect', fromId: detailsNode.id })}
          onRemoveConnection={(edgeId) => apply((g) => removeConnection(g, edgeId), { select: false })}
          onAsk={() => {
            setDetailsId(null);
            openChat({ stepId: detailsNode.id, stepLabel: detailsNode.label });
          }}
        />
      )}

      {guidedOpen && (
        <GuidedQuestions
          load={guidedQuestions}
          onCancel={() => setGuidedOpen(false)}
          onAnalyze={(answers) => {
            setGuidedOpen(false);
            startNew('guided', answers);
          }}
        />
      )}

      {chatOpen && (
        <AskFlico
          available={ai?.available ?? false}
          messages={chat.messages}
          loadError={chat.loadError}
          pending={chat.pending}
          failed={chat.failed}
          context={chatContext}
          hasIssues={issues.length > 0}
          previewId={preview?.messageId ?? null}
          busyProposal={proposalBusy}
          onSend={(content: string, mode: ChatMode) => void askFlico({ content, mode, ...(chatContext ? { stepId: chatContext.stepId } : {}) })}
          onRetry={() => chat.failed && void askFlico(chat.failed.request)}
          onDismissError={chat.dismissError}
          onReload={() => void chat.reload()}
          onClearContext={() => setChatContext(null)}
          onClear={async () => {
            if (preview) setPreview(null);
            try {
              await chat.clear();
            } catch (error) {
              setNotice((error as Error).message);
            }
          }}
          onPreview={(message) => void startPreview(message)}
          onApply={() => void applyPreview()}
          onCancelProposal={(message) => void cancelSuggestion(message)}
          onClose={closeChat}
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

/** The analysis treated as current: the latest, or the only one. */
function currentAnalysisOf(analyses: Analysis[]): Analysis | null {
  return analyses.find((a) => a.slot === 'latest') ?? analyses[0] ?? null;
}
