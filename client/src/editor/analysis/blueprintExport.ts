// Exports of an agent-ready blueprint, generated in the browser from the saved blueprint (no AI call).
// Each export says plainly that it is a starting point: Flico never builds, connects or tests anything.
import { BUILD_LABEL, readiness, type Blueprint, type BuildType } from '../../../../shared/blueprint';

export const EXPORT_FORMATS = ['claude', 'outline', 'markdown', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const FORMAT_LABEL: Record<ExportFormat, { label: string; hint: string; button: string }> = {
  claude: { label: 'Claude agent setup', hint: 'Instructions, tool list and test cases', button: 'Download agent setup' },
  outline: { label: 'n8n / Power Automate outline', hint: 'Trigger, steps, branches and approvals', button: 'Download outline' },
  markdown: { label: 'Markdown blueprint', hint: 'For a developer, IT or a ticket', button: 'Download .md' },
  json: { label: 'JSON', hint: 'For your own tools', button: 'Download .json' },
};

/** The best first export for each build type. */
export function defaultFormat(type: BuildType): ExportFormat {
  return type === 'rules' ? 'outline' : 'claude';
}

type Context = { stepName: string; workflowName: string };

const NOTICE = 'Prepared by Flico as a starting point. Nothing has been built, connected or tested: confirm every assumption, then build and test it in your own tools.';
const FIXTURE = 'Test fixture, not a live AI blueprint.';
const bullets = (items: string[], empty = '- (none yet)') => (items.length ? items.map((i) => `- ${i}`).join('\n') : empty);
const numbered = (items: string[]) => items.map((i, n) => `${n + 1}. ${i}`).join('\n');
const header = (bp: Blueprint) => [NOTICE, ...(bp.source === 'fixture' ? [FIXTURE] : [])];

function testsTable(bp: Blueprint): string {
  if (!bp.tests.length) return '(No test cases yet.)';
  const cell = (text: string) => text.replace(/\|/g, '/').replace(/\n/g, ' ');
  return ['| Case | Input | Expected result |', '|---|---|---|', ...bp.tests.map((t) => `| ${cell(t.name)} | ${cell(t.input)} | ${cell(t.expected)} |`)].join('\n');
}

function systemPrompt(bp: Blueprint, ctx: Context): string {
  const role =
    bp.buildType === 'assistant'
      ? `You prepare the work for “${ctx.stepName}” in the “${ctx.workflowName}” workflow. A person makes the decision; you never decide for them.`
      : `You handle “${ctx.stepName}” in the “${ctx.workflowName}” workflow.`;
  return [
    role,
    '',
    `Goal: ${bp.goal}`,
    `Starts when: ${bp.trigger}`,
    '',
    'How to work:',
    numbered(bp.steps),
    '',
    'Rules:',
    bullets(bp.rules, '- No rules are confirmed yet: hand every case to a person.'),
    '',
    'A person checks or approves:',
    bullets(bp.checkpoints),
    '',
    'Stop and hand over to a person when:',
    bullets([...bp.handover, 'Anything is unclear or not covered by these rules.']),
    '',
    'Never:',
    bullets([...bp.guardrails, 'Use any tool you were not given.']),
  ].join('\n');
}

export function exportClaude(bp: Blueprint, ctx: Context): string {
  const tools = bp.tools.map((t) => ({
    name: t.name,
    description: `${t.purpose} (${t.system}, ${t.access === 'read' ? 'read only' : 'can make changes'})`,
    input_schema: { type: 'object', properties: {}, additionalProperties: true },
  }));
  return [
    `# Claude agent setup: ${ctx.stepName}`,
    '',
    ...header(bp).map((line) => `> ${line}`),
    '',
    `Build type: ${BUILD_LABEL[bp.buildType]}. ${bp.buildReason}`,
    '',
    '## System prompt',
    '',
    '```text',
    systemPrompt(bp, ctx),
    '```',
    '',
    '## Tools',
    '',
    'Fill in each tool’s parameters (input_schema) to match your system. Give write access only where it is listed.',
    '',
    '```json',
    JSON.stringify(tools, null, 2),
    '```',
    '',
    '## Test cases',
    '',
    'Run these before using it on real work, and keep a person checking results at first.',
    '',
    testsTable(bp),
    '',
    '## Open questions',
    '',
    bullets(bp.openQuestions, '- None.'),
    '',
  ].join('\n');
}

export function exportOutline(bp: Blueprint, ctx: Context): string {
  const reads = bp.tools.filter((t) => t.access === 'read');
  const writes = bp.tools.filter((t) => t.access === 'write');
  return [
    `Automation outline: ${ctx.stepName} (${ctx.workflowName})`,
    ...header(bp),
    '',
    `Build type: ${BUILD_LABEL[bp.buildType]}`,
    `Trigger: ${bp.trigger}`,
    '',
    'Nodes:',
    ...reads.map((t, i) => `  ${i + 1}. Get data: ${t.purpose} [${t.system}, read]`),
    ...bp.steps.map((s, i) => `  ${reads.length + i + 1}. ${s}`),
    '',
    'Decision:',
    `  IF ${bp.rules.length ? bp.rules.join(' AND ') : '(rule not confirmed yet)'}`,
    '    -> continue',
    '  ELSE',
    `    -> hand over to a person${writes.find((t) => /notify|send|email|message/.test(t.name)) ? ` (${writes.find((t) => /notify|send|email|message/.test(t.name))!.name})` : ''}`,
    '',
    'Approvals:',
    ...(bp.checkpoints.length ? bp.checkpoints.map((c) => `  - ${c}`) : ['  - (none set)']),
    '',
    'Stop and hand over when:',
    ...bp.handover.map((h) => `  - ${h}`),
    '',
    'Never:',
    ...bp.guardrails.map((g) => `  - ${g}`),
    '',
    'Changes it may make:',
    ...(writes.length ? writes.map((t) => `  - ${t.purpose} [${t.system}]`) : ['  - None: read only.']),
    '',
    'Test with:',
    ...(bp.tests.length ? bp.tests.map((t) => `  - ${t.name}: ${t.input} -> ${t.expected}`) : ['  - (no test cases yet)']),
    '',
    'Open questions:',
    ...(bp.openQuestions.length ? bp.openQuestions.map((q) => `  - ${q}`) : ['  - None.']),
    '',
  ].join('\n');
}

export function exportMarkdown(bp: Blueprint, ctx: Context): string {
  const ready = readiness(bp);
  return [
    `# Blueprint: ${ctx.stepName}`,
    '',
    ...header(bp).map((line) => `> ${line}`),
    '',
    `**Workflow:** ${ctx.workflowName}  `,
    `**Build type:** ${BUILD_LABEL[bp.buildType]}. ${bp.buildReason}  `,
    `**Readiness:** ${ready.ready ? 'Ready to build' : `Not ready: ${ready.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(', ')}`}`,
    '',
    '## Goal',
    bp.goal,
    '',
    '## Trigger and inputs',
    `- Starts when: ${bp.trigger}`,
    ...bp.inputs.map((i) => `- Reads: ${i}`),
    '',
    '## Tools and access',
    bullets(bp.tools.map((t) => `\`${t.name}\`: ${t.purpose} (${t.system}, ${t.access})`)),
    '',
    '## Steps',
    numbered(bp.steps),
    '',
    '## Rules',
    bullets(bp.rules),
    '',
    '## Human checkpoints',
    bullets(bp.checkpoints),
    '',
    '## Hand over to a person when',
    bullets(bp.handover),
    '',
    '## Never',
    bullets(bp.guardrails),
    '',
    '## Test cases',
    testsTable(bp),
    '',
    '## Open questions',
    bullets(bp.openQuestions, '- None.'),
    '',
  ].join('\n');
}

export function exportJson(bp: Blueprint, ctx: Context): string {
  const { analysisId: _a, basis: _b, stepBasis: _s, revision: _r, ...rest } = bp;
  return `${JSON.stringify({ format: 'flico-blueprint', version: 1, notice: header(bp).join(' '), workflow: ctx.workflowName, step: ctx.stepName, ...rest, readiness: readiness(bp) }, null, 2)}\n`;
}

export function exportText(format: ExportFormat, bp: Blueprint, ctx: Context): string {
  return { claude: exportClaude, outline: exportOutline, markdown: exportMarkdown, json: exportJson }[format](bp, ctx);
}

/** File name for a download: the step name in lower case, then the format. */
export function exportFileName(format: ExportFormat, stepName: string): string {
  const slug =
    stepName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'step';
  return { claude: `${slug}-claude-agent.md`, outline: `${slug}-automation-outline.txt`, markdown: `${slug}-blueprint.md`, json: `${slug}-blueprint.json` }[format];
}
