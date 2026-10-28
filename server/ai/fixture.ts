// Deterministic test provider for development and automated tests. It is never a real AI response:
// every result is labelled "fixture" in the API and the interface, and it is refused in production.
// Directives in the input simulate failures: [fixture:retry] (invalid once, then valid),
// [fixture:invalid] (always unreadable), [fixture:partial] (always structurally invalid),
// [fixture:bad-ids] (always references steps that don't exist), [fixture:error] (provider outage).
import { AiError, AI_ERROR_MESSAGES, type AiProvider, type AiRequest, type AiResponse } from './provider.js';

type View = { steps: { ref: string; type: string; label: string }[]; connections: { ref: string; from: string; to: string; type: string }[] };

const tagged = (text: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text);
  return match ? match[1]! : null;
};
const decode = <T>(value: string | null, fallback: T): T => {
  try {
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
};
const title = (text: string, words = 6) => {
  const cleaned = text.replace(/[.!?]+$/, '').trim().split(/\s+/).slice(0, words).join(' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export class FixtureProvider implements AiProvider {
  readonly source = 'fixture' as const;

  async generate(request: AiRequest): Promise<AiResponse> {
    const first = request.messages[0]!.content;
    const attempt = request.messages.filter((m) => m.role === 'assistant').length; // >0 on the correction retry
    const last = request.messages.at(-1)!.content;
    const input = request.task === 'chat' ? (attempt ? request.messages.at(-3)!.content : last) : first;
    if (input.includes('[fixture:error]')) throw new AiError('unavailable', AI_ERROR_MESSAGES.unavailable);
    if (input.includes('[fixture:invalid]') || (input.includes('[fixture:retry]') && attempt === 0)) {
      return respond('{"this is": not json');
    }
    switch (request.task) {
      case 'draft':
        return respond(JSON.stringify(draft(decode(tagged(input, 'description'), ''))));
      case 'quick_add':
        return respond(JSON.stringify(quickAdd(decode(tagged(input, 'step_description'), ''), input.includes('"finish_allowed": true'))));
      case 'chat':
        return respond(JSON.stringify(chat(input)));
    }
  }
}

const respond = (text: string): AiResponse => ({ text, usage: { inputTokens: 0, outputTokens: 0 } });

/** One step per sentence: questions/"if" become decisions, sign-offs approvals, waiting waits. */
function draft(description: string) {
  const sentences = description
    .replace(/\[fixture:[a-z-]+\]/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  const typeOf = (s: string) =>
    /\?|^if\b|whether/i.test(s) ? 'decision' : /approv|sign[s -]?off/i.test(s) ? 'approval' : /\bwait/i.test(s) ? 'wait' : 'action';
  const steps = [
    { key: 's0', type: 'start', label: 'Start', inferred: false, notes: '' },
    ...sentences.map((s, i) => ({ key: `s${i + 1}`, type: typeOf(s), label: title(s.replace(/^if\s+/i, '')) + (typeOf(s) === 'decision' && !s.endsWith('?') ? '?' : ''), inferred: false, notes: '' })),
    { key: 'end', type: 'finish', label: 'Process complete', inferred: true, notes: '' },
  ];
  const connections: { from: string; to: string; type: string; label: string }[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]!;
    if (step.type === 'decision') {
      connections.push({ from: step.key, to: steps[i + 1]!.key, type: 'yes', label: 'Yes' });
      connections.push({ from: step.key, to: (steps[i + 2] ?? steps.at(-1)!).key, type: 'no', label: 'No' });
    } else {
      connections.push({ from: step.key, to: steps[i + 1]!.key, type: 'normal', label: '' });
    }
  }
  if (description.includes('[fixture:partial]')) connections.push({ from: 's1', to: 'missing-step', type: 'normal', label: '' });
  return {
    name: sentences.length ? title(sentences[0]!, 5) : 'Draft workflow',
    steps,
    connections,
    assumptions: [{ text: 'The process ends once the last described step is done.', steps: ['end'] }],
  };
}

function quickAdd(text: string, finishAllowed: boolean) {
  const type = /\?|^if\b|whether|check if/i.test(text)
    ? 'decision'
    : /approv|sign[s -]?off/i.test(text)
      ? 'approval'
      : /\bwait|until/i.test(text)
        ? 'wait'
        : finishAllowed && /\b(done|ends?|complete[ds]?|closed?|finish(ed)?)\b/i.test(text)
          ? 'finish'
          : 'action';
  return { type, label: title(text) };
}

const op = (fields: Record<string, string>) => ({
  op: '',
  step: '',
  new_ref: '',
  type: '',
  label: '',
  notes: '',
  from: '',
  to: '',
  connection: '',
  connection_type: '',
  ...fields,
});

function chat(input: string) {
  const view = decode<View>(tagged(input, 'workflow_data'), { steps: [], connections: [] });
  const issues = decode<string[]>(tagged(input, 'validation_issues'), []);
  const message = input.split('Their message:\n').at(-1) ?? '';
  const about = /The person is asking about step (s\d+)\./.exec(input)?.[1];
  const label = (ref: string) => view.steps.find((s) => s.ref === ref)?.label ?? ref;
  const none = { change_summary: '', operations: [] as ReturnType<typeof op>[] };

  if (message.includes('[fixture:bad-ids]')) {
    return { reply: 'Here is a change.', change_summary: 'Rename a step.', operations: [op({ op: 'update_step', step: 's999', label: 'Renamed' })] };
  }

  if (input.includes('<validation_issues>') && /smallest set of changes/.test(input)) {
    const decisions = view.steps.filter((s) => s.type === 'decision');
    const operations: ReturnType<typeof op>[] = [];
    let n = 0;
    for (const d of decisions) {
      for (const branch of ['yes', 'no'] as const) {
        if (view.connections.some((c) => c.from === d.ref && c.type === branch)) continue;
        n += 1;
        operations.push(op({ op: 'add_step', new_ref: `n${n}`, type: 'finish', label: `Outcome when ${branch === 'yes' ? 'Yes' : 'No'}` }));
        operations.push(op({ op: 'add_connection', from: d.ref, to: `n${n}`, connection_type: branch, label: branch === 'yes' ? 'Yes' : 'No' }));
      }
    }
    if (!operations.length) return { reply: `I couldn't find a safe automatic fix for: ${issues.join(' ') || 'these issues'} Please adjust it manually.`, ...none };
    return { reply: 'Each open decision path now ends in its own outcome, so no path is left unfinished. Rename the outcomes to match what really happens.', change_summary: 'Add an outcome for each open decision path.', operations };
  }

  if (/approv/i.test(message)) {
    const anchor = about ?? view.steps.find((s) => s.type === 'action')?.ref ?? view.steps[0]?.ref;
    const out = view.connections.find((c) => c.from === anchor && (c.type === 'normal' || c.type === 'yes' || c.type === 'no'));
    const operations = [op({ op: 'add_step', new_ref: 'n1', type: 'approval', label: 'Manager approval' })];
    if (out) {
      operations.push(op({ op: 'remove_connection', connection: out.ref }));
      operations.push(op({ op: 'add_connection', from: anchor!, to: 'n1', connection_type: out.type, label: out.type === 'normal' ? '' : out.type === 'yes' ? 'Yes' : 'No' }));
      operations.push(op({ op: 'add_connection', from: 'n1', to: out.to, connection_type: 'normal' }));
    } else if (anchor) {
      operations.push(op({ op: 'add_connection', from: anchor, to: 'n1', connection_type: 'normal' }));
    }
    return {
      reply: `I'd add a manager approval right after “${label(anchor ?? '')}”, so the work is checked before it continues. Preview the change on the canvas and apply it if it looks right.`,
      change_summary: `Add “Manager approval” after “${label(anchor ?? '')}”.`,
      operations,
    };
  }

  if (/\b(remove|delete)\b/i.test(message) && about) {
    const into = view.connections.filter((c) => c.to === about && c.type !== 'loop');
    const outOf = view.connections.filter((c) => c.from === about && c.type !== 'loop');
    const operations = [op({ op: 'remove_step', step: about })];
    if (into[0] && outOf[0]) operations.push(op({ op: 'add_connection', from: into[0].from, to: outOf[0].to, connection_type: into[0].type, label: into[0].type === 'yes' ? 'Yes' : into[0].type === 'no' ? 'No' : '' }));
    return { reply: `Removing “${label(about)}” and connecting the steps around it keeps the flow intact.`, change_summary: `Remove “${label(about)}”.`, operations };
  }

  const start = view.steps.find((s) => s.type === 'start');
  const finishes = view.steps.filter((s) => s.type === 'finish').map((s) => `“${s.label}”`);
  const steps = view.steps.length - (start ? 1 : 0);
  const focus = about ? ` You asked about “${label(about)}”.` : '';
  return {
    reply: `This workflow has ${steps} step${steps === 1 ? '' : 's'} after Start${finishes.length ? ` and ends at ${finishes.join(' or ')}` : ' and no Finish yet'}.${focus}${issues.length ? ` There ${issues.length === 1 ? 'is 1 open issue' : `are ${issues.length} open issues`}.` : ''}`,
    ...none,
  };
}
