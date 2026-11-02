// Deterministic test provider for development and automated tests. It is never a real AI response:
// every result is labelled "fixture" in the API and the interface, and it is refused in production.
// Directives in the input simulate failures: [fixture:retry] (invalid once, then valid),
// [fixture:invalid] (always unreadable), [fixture:partial] (always structurally invalid),
// [fixture:bad-ids] (always references steps that don't exist), [fixture:error] (provider outage).
import { AiError, AI_ERROR_MESSAGES, type AiProvider, type AiRequest, type AiResponse } from './provider.js';

type View = {
  steps: { ref: string; type: string; label: string; owner?: string; notes?: string; tools?: string[] }[];
  connections: { ref: string; from: string; to: string; type: string }[];
};

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
    const last = request.messages.at(-1)!.content;
    // The correction retry appends [previous answer, correction]; the original prompt is then third from the end.
    const attempt = last.startsWith('Your previous response could not be used') ? 1 : 0;
    const input = request.messages.at(attempt ? -3 : -1)!.content;
    if (input.includes('[fixture:error]')) throw new AiError('unavailable', AI_ERROR_MESSAGES.unavailable);
    // A slow answer, so cancellation can be tested: waits ~4 s unless the request is aborted.
    if (input.includes('[fixture:slow]')) await wait(4000, request.signal);
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
      case 'questions':
        return respond(JSON.stringify(questions(input)));
      case 'analysis':
        return respond(JSON.stringify(analysis(input, attempt)));
      case 'assist':
        return respond(JSON.stringify(assist(input, request.system)));
    }
  }
}

const respond = (text: string): AiResponse => ({ text, usage: { inputTokens: 0, outputTokens: 0 } });

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError('cancelled', AI_ERROR_MESSAGES.cancelled));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AiError('cancelled', AI_ERROR_MESSAGES.cancelled));
    });
  });
}

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
    ...sentences.map((s, i) => ({
      key: `s${i + 1}`,
      type: typeOf(s),
      // "If the amount is over 5000, the head approves it." becomes the question "The amount is over 5000?"
      label: typeOf(s) === 'decision' ? `${title(s.replace(/^if\s+/i, '').split(',')[0]!.replace(/\?$/, ''), 8)}?` : title(s),
      inferred: false,
      notes: '',
    })),
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

function questions(input: string) {
  const view = decode<View>(tagged(input, 'workflow_data'), { steps: [], connections: [] });
  const approval = view.steps.find((s) => s.type === 'approval' || s.type === 'decision');
  return {
    questions: [
      { question: 'Roughly how often does this process run?', hint: 'For example: about 40 times a week' },
      { question: 'Where does work most often get stuck or wait?', hint: 'Name a step or a hand-off' },
      ...(approval ? [{ question: `What decides the outcome at “${approval.label}”?`, hint: 'The rule or person who decides' }] : []),
    ],
  };
}

/**
 * A deterministic assessment: combine two consecutive actions (quick win), write down the criteria
 * at the first approval/decision (strategic), and log the request after Start (complex).
 * [fixture:none] = no improvements, [fixture:roi] = invented savings on the first attempt,
 * [fixture:conflict] = an extra recommendation that clashes with the quick win.
 */
function analysis(input: string, attempt: number) {
  const view = decode<View>(tagged(input, 'workflow_data'), { steps: [], connections: [] });
  const label = (ref: string) => view.steps.find((s) => s.ref === ref)?.label ?? ref;
  const flow = view.connections.filter((c) => c.type !== 'loop' && c.type !== 'exception');
  const type = (ref: string) => view.steps.find((s) => s.ref === ref)?.type;
  const base = (rest: Record<string, unknown>) => ({ benefits: '', risks: '', assumptions: '', verification: '', depends_on: [] as string[], ...rest });

  if (input.includes('[fixture:none]')) {
    return {
      headline: 'This workflow is already in good shape.',
      summary: 'The steps follow a clear order, every path ends in an outcome, and there is no duplicate work. Flico found no changes worth recommending.',
      outcome: 'no_improvements',
      assumptions: ['The workflow shows every step that happens today.'],
      recommendations: [],
      automation: automation(view, []),
    };
  }

  const recs: Record<string, unknown>[] = [];
  // Quick win: two actions in a row, the second removed and its path kept.
  const pair = flow.find((c) => c.type === 'normal' && type(c.from) === 'action' && type(c.to) === 'action');
  if (pair) {
    const after = flow.filter((c) => c.from === pair.to);
    recs.push(
      base({
        key: 'r1',
        title: `Combine “${label(pair.from)}” and “${label(pair.to)}”`,
        problem: 'Two manual steps in a row repeat similar work and add a hand-off.',
        proposal: `Do both in “${label(pair.from)}” and remove “${label(pair.to)}”.`,
        reason: 'Fewer hand-offs mean less waiting and fewer chances for mistakes.',
        category: 'quick_win',
        impact: 'medium',
        effort: 'low',
        evidence: 'supported',
        benefits: 'Fewer hand-offs and less duplicate checking.',
        risks: 'The combined step must still cover everything the second step did.',
        assumptions: 'The same person or team can do both steps.',
        verification: 'Check with the people involved that nothing in the second step is lost.',
        operations: [
          op({ op: 'remove_step', step: pair.to }),
          ...after.map((c) => op({ op: 'add_connection', from: pair.from, to: c.to, connection_type: c.type, label: c.type === 'yes' ? 'Yes' : c.type === 'no' ? 'No' : '' })),
        ],
      }),
    );
  }
  // Strategic: write down the criteria at the first approval or decision.
  const gate = view.steps.find((s) => s.type === 'approval' || s.type === 'decision');
  if (gate) {
    recs.push(
      base({
        key: 'r2',
        title: `Write down the criteria for “${gate.label}”`,
        problem: 'The rule for this decision is not recorded in the workflow.',
        proposal: 'Add the decision criteria to the step so everyone applies the same rule.',
        reason: 'Clear criteria make the outcome consistent and easier to delegate.',
        category: 'strategic',
        impact: 'medium',
        effort: 'medium',
        evidence: 'verify',
        benefits: 'More consistent decisions and fewer questions back and forth.',
        risks: 'Criteria that are too strict could slow down unusual cases.',
        assumptions: 'There is an agreed rule that can be written down.',
        verification: 'Confirm the criteria with whoever owns this decision today.',
        operations: [op({ op: 'update_step', step: gate.ref, notes: 'Criteria: to be agreed and written down.' })],
      }),
    );
  }
  // Complex: log every request right after Start.
  const start = view.steps.find((s) => s.type === 'start');
  const first = start && flow.find((c) => c.from === start.ref);
  if (start && first) {
    recs.push(
      base({
        key: 'r3',
        title: 'Log every request when it arrives',
        problem: 'There is no single record of incoming requests, so status questions are hard to answer.',
        proposal: 'Add a step that records each request in one shared place before work starts.',
        reason: 'A shared log makes progress visible and prevents requests from being lost.',
        category: 'complex',
        impact: 'high',
        effort: 'high',
        evidence: 'assumption',
        benefits: 'Better visibility and fewer lost requests.',
        risks: 'Needs a shared tool and a habit change for everyone involved.',
        assumptions: 'Requests currently arrive through several channels.',
        verification: 'Check which tool the team could use and whether it fits current systems.',
        operations: [
          op({ op: 'add_step', new_ref: 'n1', type: 'action', label: 'Log the request' }),
          op({ op: 'remove_connection', connection: first.ref }),
          op({ op: 'add_connection', from: start.ref, to: 'n1', connection_type: 'normal' }),
          op({ op: 'add_connection', from: 'n1', to: first.to, connection_type: first.type === 'normal' ? 'normal' : first.type }),
        ],
      }),
    );
  }
  if (input.includes('[fixture:conflict]') && pair) {
    recs.push(
      base({
        key: 'r4',
        title: `Clarify “${label(pair.to)}”`,
        problem: 'This step is described only briefly.',
        proposal: 'Rename the step so its purpose is clear.',
        reason: 'Clear names reduce confusion.',
        category: 'quick_win',
        impact: 'low',
        effort: 'low',
        evidence: 'supported',
        operations: [op({ op: 'update_step', step: pair.to, label: `${label(pair.to)} (clarified)` })],
      }),
    );
  }
  const roi = input.includes('[fixture:roi]') && attempt === 0;
  return {
    headline: recs.length ? 'A clearer, leaner way to run this workflow.' : 'This workflow is already in good shape.',
    summary: recs.length
      ? `The workflow is easy to follow, but some steps repeat work or rely on unwritten rules. Flico proposes ${recs.length} change${recs.length === 1 ? '' : 's'}; these are proposals, not applied changes.${roi ? ' This will save 30% of processing time and $12,000 a year.' : ''}`
      : 'Flico found no changes worth recommending.',
    outcome: recs.length ? 'improvements' : 'no_improvements',
    assumptions: ['The workflow shows every step that happens today.'],
    recommendations: recs,
    automation: automation(view, []),
  };
}

// ---------- automation assessments (deterministic stand-ins for the model's judgment) ----------

type Turn = { step: string; question: string; answer: string };

const quoteOf = (text: string) => `“${text.length > 120 ? `${text.slice(0, 117)}…` : text}”`;

/** Classify one work step from its details and the person's answers about it. */
function assess(view: View, ref: string, answers: Turn[]) {
  const step = view.steps.find((s) => s.ref === ref)!;
  const own = answers.filter((a) => a.step === ref && a.answer !== '(skipped for now)');
  const said = [step.notes ?? '', ...own.map((a) => a.answer)].join(' ');
  const text = `${step.label} ${said}`.toLowerCase();
  const previous = view.connections.find((c) => c.to === ref);
  const before = previous ? view.steps.find((s) => s.ref === previous.from)?.label : undefined;
  const evidence = [
    ...(step.notes ? [{ source: 'user', text: `Step notes: ${quoteOf(step.notes)}` }] : []),
    ...own.map((a) => ({ source: 'user', text: `${a.question} ${quoteOf(a.answer)}` })),
    { source: 'workflow', text: before ? `Follows “${before}” in the workflow.` : 'Position in the workflow.' },
  ];
  const volume = /(\d[\d,]*)\s*(?:\w+\s)?(?:a|per)\s+(day|week|month)/i.exec(said);
  const value = volume ? `Runs about ${volume[1]} times a ${volume[2]} (you said), but time per run isn't known, so the value can't be estimated.` : '';
  const dims = (over: Partial<Record<'inputs' | 'rules' | 'access' | 'exceptions' | 'verification' | 'risk', string>>) => ({
    inputs: 'Not described yet.',
    rules: 'Not described yet.',
    access: 'Not described: a tool name alone does not show access.',
    exceptions: 'Not described yet.',
    verification: 'Not described yet.',
    risk: 'Not described yet.',
    ...over,
  });
  const base = { step: ref, value, questions: [] as string[], prerequisites: [] as string[] };

  const human = /physical|on site|on-site|in person|inspect|wet signature|legally/.exec(text);
  if (human) {
    return {
      ...base,
      classification: 'human',
      provisional: false,
      reasoning: `The details say this needs ${human[0]} work by a person, which software can't do here.`,
      ...dims({ rules: 'Depends on a person on site.', risk: 'Errors would be found late if skipped.' }),
      automatable: '',
      human: `The ${human[0]} part (you said).`,
      evidence,
    };
  }
  if (/quot(e|ation)/.test(text) && /compar/.test(text)) {
    const statedHuman = /technical|evaluat|select|choose|decid/.test(said.toLowerCase());
    return {
      ...base,
      classification: 'assisted',
      provisional: true,
      reasoning: 'Reading the quotations and lining up prices and terms can be automated; choosing the supplier remains a human evaluation.',
      ...dims({ inputs: 'Quotations arrive as documents (stated).', rules: 'Comparison is mechanical; the choice involves judgment.' }),
      automatable: 'Extract prices, terms and delivery dates from each quotation and build a side-by-side comparison.',
      human: statedHuman ? 'The technical evaluation and the final selection stay with the team (you said).' : 'The final selection stays with a person (assumption).',
      evidence: statedHuman ? evidence : [...evidence, { source: 'assumption', text: 'A person makes the final choice.' }],
      prerequisites: ['Check that quotation formats can be read reliably.'],
    };
  }
  const rules = /rule|policy|threshold|always|criteria/.test(text);
  const access = /access|api|erp|crm|integration|export|database/.test(text);
  const check = /check|verif|validat|reconcil|confirm/.test(text);
  if (rules && access && check) {
    return {
      ...base,
      classification: 'full',
      provisional: true,
      reasoning: 'The stated rules, digital inputs, system access and checks support doing the normal task without routine human involvement. Nothing has been tested yet.',
      ...dims({ inputs: 'Digital and usable (stated).', rules: 'Fixed rules (stated).', access: 'Access described by you, not yet tested.', exceptions: 'Cases the rules don\'t cover go to a person.', verification: 'Results can be checked as described.', risk: 'Low if checks run on every case.' }),
      automatable: 'Apply the stated rules to the digital inputs through the described system access, with an automatic check on every result.',
      human: '',
      evidence: [...evidence, { source: 'assumption', text: 'The described access and checks work as stated.' }],
      prerequisites: ['Confirm the stated system access works in a test.', 'Test the rules against past cases.'],
    };
  }
  if (step.type === 'approval' && !/no approval/.test(text)) {
    return {
      ...base,
      classification: 'assisted',
      provisional: true,
      reasoning: 'Collecting and routing the information can be automated; the approval itself is a human decision of authority.',
      ...dims({ rules: 'Approval is a decision of authority.', risk: 'An approver is accountable for the outcome.' }),
      automatable: 'Prepare the approval request with all information and route it to the approver.',
      human: `The approval decision stays with ${step.owner ? quoteOf(step.owner) : 'the approver'}.`,
      evidence: [...evidence, { source: 'workflow', text: 'This is an approval step.' }],
      prerequisites: ['Confirm who approves and on what basis.'],
    };
  }
  const missing = !own.some((a) => /come from|source|information/.test(a.question)) ? `For “${step.label}”, where does the information come from?` : `For “${step.label}”, which rule or criteria decide the result?`;
  return {
    ...base,
    classification: 'unknown',
    provisional: false,
    reasoning: access && !rules
      ? 'System access is described, but not the rules that decide the result, so a defensible classification is not possible yet.'
      : 'The details don\'t say where the inputs come from or what rules apply, so a defensible classification is not possible yet.',
    ...dims({}),
    automatable: '',
    human: '',
    evidence,
    questions: [missing],
  };
}

const ASSESSABLE = new Set(['action', 'approval', 'decision', 'exception']);

function automation(view: View, answers: Turn[]) {
  return view.steps.filter((s) => ASSESSABLE.has(s.type)).map((s) => assess(view, s.ref, answers));
}

// ---------- interviews about one step: Clarify and briefs ----------

const CLASS_NAME: Record<string, string> = { full: 'Full automation candidate', assisted: 'Human-assisted automation', human: 'Keep human-led', unknown: 'More information needed' };

function assist(input: string, system: string) {
  const view = decode<View>(tagged(input, 'workflow_data'), { steps: [], connections: [] });
  const interview = decode<{ question: string; answer: string }[]>(tagged(input, 'interview'), []);
  const ref = /The selected step is (s\d+)\./.exec(input)?.[1] ?? '';
  const label = view.steps.find((s) => s.ref === ref)?.label ?? 'this step';
  const turns = (extra: { question: string; answer: string }[] = []): Turn[] => [...interview, ...extra].map((t) => ({ step: ref, question: t.question, answer: t.answer === '(skipped)' ? '(skipped for now)' : t.answer }));
  const asked = (extra: string[] = []) => [...interview.map((t) => t.question), ...extra];
  const clarifyQuestions = [`Where does the information for “${label}” come from?`, `Which rule or criteria decide the result of “${label}”?`, `Who checks the result of “${label}”?`];
  const nextOf = (candidates: string[], extra: string[] = []) => candidates.find((q) => !asked(extra).includes(q)) ?? '';

  if (input.includes('Task: update the assessment')) {
    const latest = decode<{ question: string; answer: string }[]>(tagged(input, 'answers'), [])[0]!;
    const updated = assess(view, ref, turns([latest]));
    return {
      reply: `Thanks. With that, “${label}” is ${CLASS_NAME[updated.classification]}${updated.provisional ? ' (provisional)' : ''}.`,
      assessment: updated,
      next_question: updated.classification === 'unknown' || updated.provisional ? nextOf(clarifyQuestions, [latest.question]) : '',
    };
  }
  if (input.includes('Task: write the brief.')) return writeFixtureBrief(system, label, interview);

  const kind = /automation brief/.test(system) ? 'automation' : /assist brief/.test(system) ? 'assist' : /support ideas/.test(system) ? 'support' : null;
  const candidates = !kind
    ? clarifyQuestions
    : {
        automation: [`What starts “${label}”, and how often does it happen?`, 'Which systems hold the inputs, and who can grant access?', "What should happen when something doesn't match?", 'Who would own this automation once it runs?'],
        assist: [`What exactly does the person check or decide in “${label}”?`, 'What should be prepared for them before they start?', 'Which systems are involved?'],
        support: [`Where do mistakes or delays happen in “${label}”?`, 'What would help the person doing it most?'],
      }[kind];
  const question = nextOf(candidates);
  return { done: !question, question };
}

function writeFixtureBrief(system: string, label: string, interview: { question: string; answer: string }[]) {
  const headings = [...system.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((h) => h[0] === h[0]!.toUpperCase());
  const order = headings.slice(0, headings.indexOf('Assumptions to confirm') + 1);
  const answered = interview.filter((t) => t.answer !== '(skipped)');
  const skipped = interview.filter((t) => t.answer === '(skipped)');
  let next = 0;
  const said = () => (answered[next] ? `You said: ${quoteOf(answered[next++]!.answer)}` : 'Not discussed yet.');
  const items = (heading: string): string[] => {
    if (heading === 'Goal') return [`Make “${label}” quicker and more consistent.`];
    if (heading === 'Possible approaches') return ['An integration platform linking the systems you named, if they offer access.', 'A script or RPA bot for the repetitive part, if no integration exists.'];
    if (heading === 'Assumptions to confirm') return [...skipped.map((t) => `Unanswered: ${t.question}`), 'Nothing has been built or tested yet: confirm access and rules in a test.'];
    if (heading === 'Ideas') return ['A short checklist for the step.', 'A template for the information it needs.'];
    return [said()];
  };
  return { summary: `How “${label}” could be handled, based on your answers. Test fixture, not a live AI response.`, sections: order.map((heading) => ({ heading, items: items(heading) })) };
}
