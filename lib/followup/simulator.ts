import { flowGraphSchema, nodeBranches, type FlowGraph } from './graph-schema';
import { processNode, selectEdge, classEdgeMatch, type EnrollmentRow, type LeadFacts } from './node-handlers';
import { evaluateExpression, type ExpressionValue } from './expression';
import { sessionVariablesSchema, sessionVariableValues, type SessionVariables } from './session-variables';
import { renderSessionText } from './render-session-text';
import { validateAnswer } from './answer-validation';

/** Pure draft replay. No clients, credentials, network, storage or jobs are accepted. */
export interface SimulationInput {
  reply?: string;
  choice_id?: string;
  timeout?: boolean;
  branch?: string;
  mock_output?: ExpressionValue;
}
export interface SimulationState {
  graph: FlowGraph;
  node_id: string;
  status: 'running' | 'completed' | 'failed';
  now: string;
  variables: SessionVariables;
  facts: LeadFacts;
  last_reply: string;
  repeats: Record<string, { index: number; total: number }>;
  trace: { node_id: string; message: string; variables: SessionVariables }[];
}
export function startSimulation(raw: unknown, now = new Date().toISOString()): SimulationState {
  const graph = flowGraphSchema.parse(raw);
  const starts = graph.nodes.filter(node => node.type === 'trigger');
  if (starts.length !== 1 || !starts[0]) throw new Error('Exactly one start block is required.');
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid simulation clock.');
  return { graph, node_id: starts[0].id, status: 'running', now, variables: {},
    facts: { lead_stage: null, tags: [], steps_taken: 0, last_outcome: null }, last_reply: '', repeats: {}, trace: [] };
}

/** One explicit operator step; clocks and external results are simulated. */
export function stepSimulation(previous: SimulationState, input: SimulationInput = {}): SimulationState {
  if (previous.status !== 'running') return previous;
  const state = structuredClone(previous);
  const node = state.graph.nodes.find(item => item.id === state.node_id);
  const record = (message: string) => state.trace.push({ node_id: state.node_id, message, variables: structuredClone(state.variables) });
  const fail = (message: string) => { record(message); state.status = 'failed'; return state; };
  if (state.trace.length >= 200) return fail('Simulation stopped at the 200-step safety limit.');
  if (!node) return fail('The next block no longer exists.');
  const advance = (target: string | undefined, message: string) => {
    if (!target) return fail('No connected output for this result.');
    record(message); state.node_id = target; return state;
  };
  const always = () => selectEdge(state.graph.edges, node.id, { type: 'always' })?.target;
  const setVariable = (key: string, value: ExpressionValue) => {
    if (value === null) throw new Error('A simulated output must be text, a number or true/false.');
    state.variables = sessionVariablesSchema.parse({ ...state.variables, [key]: { type: typeof value, value } });
  };
  try {
    state.facts.steps_taken = state.trace.length;
    state.facts.variables = sessionVariableValues(state.variables);
    if (node.type === 'action') {
      if (node.config.mode === 'set_variable') {
        const result = evaluateExpression(node.config.expression, state.facts.custom_fields ?? {}, state.facts.variables);
        if (!result.ok || typeof result.value !== node.config.value_type) return fail('Variable expression failed or returned the wrong type.');
        setVariable(node.config.key, result.value);
        return advance(always(), `Set session.${node.config.key}`);
      }
      if (node.config.mode === 'integration') {
        if (input.branch !== 'success' && input.branch !== 'error') return state;
        for (const expression of Object.values(node.config.mappings)) {
          if (!evaluateExpression(expression, state.facts.custom_fields ?? {}, state.facts.variables).ok) return fail('An integration input mapping could not be resolved.');
        }
        if (input.branch === 'success' && node.config.output) {
          if (input.mock_output === undefined) return fail('Supply a mock output for the configured session variable.');
          setVariable(node.config.output.variable, input.mock_output);
        }
        return advance(selectEdge(state.graph.edges, node.id, { type: 'branch', branch_id: input.branch })?.target,
          `MOCK integration ${node.config.action}: ${input.branch}. No external request.`);
      }
      const preview = node.config.mode === 'text' || node.config.mode === 'interactive'
        ? renderSessionText(node.config.body, state.variables, node.config.mode === 'text' ? 4000 : 1024)
        : `MOCK ${node.config.mode}: no media loaded, AI called or message sent.`;
      return advance(always(), preview);
    }
    if (node.type === 'ai_classify') {
      if (!input.branch) return state;
      if (!nodeBranches(node).some(branch => branch.id === input.branch)) return fail('Choose a configured classification branch.');
      return advance(selectEdge(state.graph.edges, node.id, classEdgeMatch(node, input.branch))?.target,
        `MOCK classification: ${input.branch}. No AI call.`);
    }
    if (node.type === 'match_reply' && input.reply === undefined && !input.timeout && input.choice_id === undefined) return state;
    if (node.type === 'match_reply' && node.config.save_to && node.config.if_exists && node.config.if_exists !== 'overwrite') {
      return fail('Existing-value skip/confirmation needs a seeded contact test; this simulator does not verify that behavior.');
    }
    const enrollment: EnrollmentRow = { id: 'simulation', organization_id: 'simulation', pointer_id: 'simulation', version_id: 'simulation',
      contact_id: 'simulation', conversation_id: null, current_node_id: node.id, status: 'active', next_eval_at: null,
      claimed_until: null, attempts: 0, max_attempts: 1, last_error: null, steps_taken: state.trace.length,
      outcome: null, cancel_reason: null, started_at: state.now, completed_at: null, updated_at: state.now };
    if (input.reply !== undefined) state.last_reply = input.reply;
    const result = processNode({ node, edges: state.graph.edges, enrollment, lead: state.facts, clock: () => new Date(state.now),
      waitElapsed: true, wokeEarly: !input.timeout, lastInboundBody: state.last_reply, selectedChoiceId: input.choice_id,
      repeatTaken: state.repeats[node.id]?.index, repeatTotal: state.repeats[node.id]?.total });
    if (result.kind === 'advance') {
      if (node.type === 'match_reply' && !input.timeout && node.config.save_to && node.config.answer_format) {
        const answer = validateAnswer(node.config.answer_format, state.last_reply);
        if (answer.valid) {
          const dest = node.config.save_to;
          if (dest.kind === 'session_variable') setVariable(dest.key, node.config.answer_format === 'number' ? Number(answer.value) : answer.value);
          else if (dest.kind === 'contact_name') state.facts.contact_name = answer.value;
          else state.facts.custom_fields = { ...state.facts.custom_fields, [dest.key]: answer.value };
        }
      }
      if (result.repeat) state.repeats[node.id] = result.repeat;
      if (node.type === 'wait') {
        const duration = node.config.mode === 'fixed' ? node.config.duration_ms : node.config.min_ms;
        state.now = new Date(Date.parse(state.now) + duration).toISOString();
      }
      return advance(result.next_node_id, node.type === 'wait' ? `Virtual wait; clock now ${state.now}` : `${node.label}: next step`);
    }
    if (result.kind === 'complete') { record(`Completed: ${result.outcome ?? result.cancel_reason ?? 'end'}`); state.status = 'completed'; return state; }
    if (result.kind === 'fail') return fail(result.error);
    if (result.kind === 'dead') return fail(result.reason);
    return fail('This step requires an explicit simulated input.');
  } catch {
    return fail('Simulation input or variable configuration is invalid. Check this block.');
  }
}
